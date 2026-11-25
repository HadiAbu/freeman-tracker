import logging
import math
import threading
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.alert_loop import start_alert_loop
from app.alert_routes import router as alert_router
from app.analysis.routes import router as analysis_router
from app.auth import current_user_id
from app.auth_routes import router as auth_router
from app.market_routes import router as market_router
from app.config import get_settings
from app.db import connect, get_conn, init_schema, one, rows
from app.models import HoldingMeta, PriceIn, TradeIn, TradePatch, WatchIn, WatchPatch
from app.portfolio import (
    OversellError,
    allocation,
    build_summary,
    compute_positions,
    first_trade_order,
    value_history,
)
from app.alerts import ARMED, TRIGGERED, initial_state
from app.ledger import (
    PRICE_VISIBLE,
    all_trades as _all_trades,
    latest_market_price as _latest_market_price,
    latest_marks as _latest_marks,
    price_kind as _price_kind,
    latest_price as _latest_price,
    latest_prices as _latest_prices,
    meta as _meta,
    positions as _positions,
    summary as _summary,
    to_trade as _to_trade,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    gen = _app.dependency_overrides.get(get_conn, get_conn)()
    conn = next(gen)
    try:
        init_schema(conn)
    finally:
        gen.close()

    # The price alert checker lives as long as the server. It starts only when market data and
    # email are configured (see start_alert_loop). A failure to start it must not stop the API.
    stop = threading.Event()
    try:
        settings = _app.dependency_overrides.get(get_settings, get_settings)()
        start_alert_loop(
            settings, lambda: connect(settings.turso_database_url, settings.turso_auth_token), stop
        )
    except Exception:
        logging.getLogger("freeman.alerts").exception("price alerts could not start")
    yield
    stop.set()


app = FastAPI(title="Freeman API", version="0.1.0", lifespan=lifespan)

_origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"]
    )

app.include_router(auth_router)
app.include_router(analysis_router)
app.include_router(market_router)
app.include_router(alert_router)


def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    """FastAPI's usual 422, except that an infinite or NaN number it echoes back is sent as text:
    JSON has no way to write one, so the error reply itself would fail with a 500."""
    return await request_validation_exception_handler(
        request, RequestValidationError(_json_safe(exc.errors()))
    )


@app.get("/health")
def health():
    return {"ok": True}


# ---------- helpers ----------
# One writer at a time, per user, for anything that checks the ledger and then writes it. Without this,
# two concurrent requests can both pass the oversell check and together break the invariant.
# It covers a single server process (how this app is deployed); a multi-process deployment
# would need a database-level guard instead.
_user_locks: dict[int, threading.Lock] = {}


def _write_lock(user_id: int) -> threading.Lock:
    """One lock per user: two users never wait for each other, but one user's concurrent writes
    are still serialized."""
    return _user_locks.setdefault(user_id, threading.Lock())


def _check(trades: list[dict]) -> None:
    """Reject any change that would leave a sell larger than the shares held."""
    try:
        compute_positions(_to_trade(r) for r in trades)
    except OversellError as e:
        raise HTTPException(409, str(e))


# ---------- trades ----------
# Every route below takes `uid` from the access token and filters every query by it. A row id from
# the URL is never trusted on its own: it is always looked up together with the user id, so another
# user's id answers 404, not their data.
@app.post("/trades", status_code=201)
def create_trade(body: TradeIn, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    new = {**body.model_dump(), "traded_at": body.traded_at.isoformat(), "id": 10**12}
    with _write_lock(uid):
        _check(_all_trades(conn, uid) + [new])
        cur = conn.execute(
            "INSERT INTO trades (user_id, ticker, side, shares, price, fee, traded_at, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, body.ticker, body.side, body.shares, body.price, body.fee, new["traded_at"], body.note),
        )
        conn.commit()
    return one(conn.execute("SELECT * FROM trades WHERE id = ? AND user_id = ?", (cur.lastrowid, uid)))


@app.get("/trades")
def list_trades(
    ticker: str | None = None,
    side: Literal["buy", "sell"] | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
):
    """Newest first. Page with limit/offset; a page shorter than `limit` is the last one."""
    sql, args = "SELECT * FROM trades WHERE user_id = ?", [uid]
    if ticker:
        sql += " AND ticker = ?"
        args.append(ticker.upper())
    if side:
        sql += " AND side = ?"
        args.append(side)
    sql += " ORDER BY traded_at DESC, id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    return rows(conn.execute(sql, args))


@app.patch("/trades/{trade_id}")
def patch_trade(
    trade_id: int, body: TradePatch, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    with _write_lock(uid):
        current = one(
            conn.execute("SELECT * FROM trades WHERE id = ? AND user_id = ?", (trade_id, uid))
        )
        if not current:
            raise HTTPException(404, "Trade not found")
        changes = body.model_dump(exclude_unset=True)
        if changes.get("traded_at") is not None:
            changes["traded_at"] = changes["traded_at"].isoformat()
        # null clears only the optional note; other fields cannot be nulled
        changes = {k: v for k, v in changes.items() if v is not None or k == "note"}
        updated = {**current, **changes}
        _check([updated if r["id"] == trade_id else r for r in _all_trades(conn, uid)])
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(
                f"UPDATE trades SET {sets} WHERE id = ? AND user_id = ?",
                (*changes.values(), trade_id, uid),
            )
            conn.commit()
    return one(conn.execute("SELECT * FROM trades WHERE id = ? AND user_id = ?", (trade_id, uid)))


@app.delete("/trades/{trade_id}", status_code=204)
def delete_trade(trade_id: int, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    with _write_lock(uid):
        if not one(conn.execute("SELECT id FROM trades WHERE id = ? AND user_id = ?", (trade_id, uid))):
            raise HTTPException(404, "Trade not found")
        _check([r for r in _all_trades(conn, uid) if r["id"] != trade_id])
        conn.execute("DELETE FROM trades WHERE id = ? AND user_id = ?", (trade_id, uid))
        conn.commit()


# ---------- watchlist ----------
def _check_limits(upper: float | None, lower: float | None) -> None:
    if upper is not None and lower is not None and lower >= upper:
        raise HTTPException(422, "The lower limit must be below the upper limit.")


def _new_limit_states(conn, uid: int, ticker: str, limits: dict[str, float | None]) -> dict:
    """The state a new or changed limit starts in, for each side in `limits`.

    It starts 'triggered' if either the price the user sees or the newest market mark is past it
    (see alerts.initial_state). The checker compares market prices, so a same-day manual mark must
    not hide that the market is already past the limit: that would email within minutes.
    """
    prices = (_latest_price(conn, uid, ticker), _latest_market_price(conn, ticker))
    states = {}
    for side, limit in limits.items():
        reached = any(initial_state(side, p, limit) == TRIGGERED for p in prices)
        states[f"{side}_state"] = TRIGGERED if reached else ARMED
    return states


@app.post("/watchlist", status_code=201)
def add_watch(body: WatchIn, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    _check_limits(body.upper_limit, body.lower_limit)
    st = _new_limit_states(
        conn, uid, body.ticker, {"upper": body.upper_limit, "lower": body.lower_limit}
    )
    # An unchanged limit keeps its stored state. That is decided inside the statement: a state read
    # earlier could overwrite a 'triggered' the checker committed since, and email a second time.
    conn.execute(
        "INSERT INTO watchlist (user_id, ticker, name, upper_limit, lower_limit, upper_state,"
        " lower_state, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET name = excluded.name,"
        " upper_limit = excluded.upper_limit, lower_limit = excluded.lower_limit,"
        " upper_state = CASE WHEN watchlist.upper_limit IS excluded.upper_limit"
        " THEN watchlist.upper_state ELSE excluded.upper_state END,"
        " lower_state = CASE WHEN watchlist.lower_limit IS excluded.lower_limit"
        " THEN watchlist.lower_state ELSE excluded.lower_state END,"
        " note = excluded.note",
        (
            uid, body.ticker, body.name, body.upper_limit, body.lower_limit,
            st["upper_state"], st["lower_state"], body.note,
        ),
    )
    conn.commit()
    return one(
        conn.execute("SELECT * FROM watchlist WHERE user_id = ? AND ticker = ?", (uid, body.ticker))
    )


@app.get("/watchlist")
def list_watch(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    latest = _latest_marks(conn, uid)
    items = rows(conn.execute("SELECT * FROM watchlist WHERE user_id = ? ORDER BY ticker", (uid,)))
    for w in items:
        mark = latest.get(w["ticker"])
        w["price"] = mark["price"] if mark else None
        w["price_as_of"] = mark["as_of"] if mark else None
        w["price_kind"] = _price_kind(mark["source"]) if mark else None
        t = w["upper_limit"]
        w["pct_to_target"] = (
            (t - w["price"]) / w["price"] * 100 if t is not None and w["price"] else None
        )
    return items


@app.patch("/watchlist/{item_id}")
def patch_watch(
    item_id: int, body: WatchPatch, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    old = one(conn.execute("SELECT * FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid)))
    if not old:
        raise HTTPException(404, "Watchlist item not found")
    changes = body.model_dump(exclude_unset=True)
    upper = changes.get("upper_limit", old["upper_limit"])
    lower = changes.get("lower_limit", old["lower_limit"])
    _check_limits(upper, lower)
    # Only a limit that really changed gets a new state. The state of an unchanged one is not
    # written at all, so a 'triggered' the checker committed since `old` was read survives.
    changed = {
        side: new for side, new in (("upper", upper), ("lower", lower)) if new != old[f"{side}_limit"]
    }
    if changed:
        changes.update(_new_limit_states(conn, uid, old["ticker"], changed))
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(
            f"UPDATE watchlist SET {sets} WHERE id = ? AND user_id = ?",
            (*changes.values(), item_id, uid),
        )
        conn.commit()
    return one(conn.execute("SELECT * FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid)))


@app.delete("/watchlist/{item_id}", status_code=204)
def delete_watch(item_id: int, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    if not one(conn.execute("SELECT id FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid))):
        raise HTTPException(404, "Watchlist item not found")
    conn.execute("DELETE FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid))
    conn.commit()


# ---------- prices ----------
# A manual mark belongs to the user who entered it. Marks from a market-data provider have no owner
# and are visible to everyone (see ledger.PRICE_VISIBLE).
@app.post("/prices", status_code=201)
def add_price(body: PriceIn, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    cur = conn.execute(
        "INSERT INTO prices (user_id, ticker, price, as_of, source) VALUES (?, ?, ?, ?, ?)",
        (uid, body.ticker, body.price, body.as_of.isoformat(), body.source),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM prices WHERE id = ? AND user_id = ?", (cur.lastrowid, uid)))


@app.get("/prices")
def latest_prices(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    return [m for _, m in sorted(_latest_marks(conn, uid).items())]


@app.get("/prices/{ticker}")
def price_history(ticker: str, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    return rows(
        conn.execute(
            f"SELECT * FROM prices WHERE ticker = ? AND {PRICE_VISIBLE} ORDER BY as_of, id",
            (ticker.upper(), uid),
        )
    )


# ---------- holding metadata (name / sector / asset class for allocation pies) ----------
@app.put("/holdings/{ticker}")
def put_holding(
    ticker: str, body: HoldingMeta, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    t = ticker.strip().upper()
    conn.execute(
        "INSERT INTO holdings (user_id, ticker, name, sector, asset_class) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET"
        " name = excluded.name, sector = excluded.sector, asset_class = excluded.asset_class",
        (uid, t, body.name, body.sector, body.asset_class),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM holdings WHERE user_id = ? AND ticker = ?", (uid, t)))


_HOLDING_COLUMNS = ("name", "sector", "asset_class")  # fixed whitelist for PATCH


@app.patch("/holdings/{ticker}")
def patch_holding(
    ticker: str, body: HoldingMeta, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    """Partial update: only fields present in the body change; an explicit null clears."""
    t = ticker.strip().upper()
    changes = body.model_dump(exclude_unset=True)
    cols = [c for c in _HOLDING_COLUMNS if c in changes]
    if not cols:
        raise HTTPException(status_code=422, detail="nothing to update")
    conn.execute("INSERT OR IGNORE INTO holdings (user_id, ticker) VALUES (?, ?)", (uid, t))
    sets = ", ".join(f"{c} = ?" for c in cols)  # column names come from the whitelist only
    conn.execute(
        f"UPDATE holdings SET {sets} WHERE user_id = ? AND ticker = ?",
        (*[changes[c] for c in cols], uid, t),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM holdings WHERE user_id = ? AND ticker = ?", (uid, t)))


# ---------- portfolio (derived, chart-ready) ----------
@app.get("/portfolio/summary")
def portfolio_summary(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    out = asdict(_summary(conn, uid))
    marks = _latest_marks(conn, uid)
    for h in out["holdings"]:
        # Only meaningful when the price came from a mark; a last-trade fallback has no date here.
        mark = marks.get(h["ticker"]) if h["price_source"] == "price" else None
        h["price_as_of"] = mark["as_of"] if mark else None
        h["price_kind"] = _price_kind(mark["source"]) if mark else "trade"
    return out


@app.get("/portfolio/allocation")
def portfolio_allocation(
    by: Literal["ticker", "sector", "asset_class"] = "ticker",
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
):
    trades = _all_trades(conn, uid)
    positions = _positions(trades)
    meta = _meta(conn, uid)
    summary = build_summary(positions, _latest_prices(conn, uid), meta)
    # `slot` identity comes from every ticker ever traded (closed ones too), so colors on the
    # client do not shift when a position is opened, resized or closed.
    return allocation(summary, by, first_trade_order(_to_trade(r) for r in trades), meta)


@app.get("/portfolio/history")
def portfolio_history(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    trades = _all_trades(conn, uid)
    _positions(trades)  # surfaces an inconsistent ledger as a clear 409 before the history pass
    points = [
        (r["ticker"], date.fromisoformat(r["as_of"]), r["price"])
        for r in rows(
            conn.execute(
                f"SELECT ticker, as_of, price FROM prices WHERE {PRICE_VISIBLE} ORDER BY as_of, id",
                (uid,),
            )
        )
    ]
    return value_history((_to_trade(r) for r in trades), points)
