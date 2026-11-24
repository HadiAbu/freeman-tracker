import threading
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.analysis.routes import router as analysis_router
from app.auth import current_user_id
from app.auth_routes import router as auth_router
from app.config import get_settings
from app.db import get_conn, init_schema, one, rows
from app.models import HoldingMeta, PriceIn, TradeIn, TradePatch, WatchIn, WatchPatch
from app.portfolio import (
    OversellError,
    allocation,
    build_summary,
    compute_positions,
    first_trade_order,
    value_history,
)
from app.ledger import (
    PRICE_VISIBLE,
    all_trades as _all_trades,
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
    yield


app = FastAPI(title="Freeman API", version="0.1.0", lifespan=lifespan)

_origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"]
    )

app.include_router(auth_router)
app.include_router(analysis_router)


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
@app.post("/watchlist", status_code=201)
def add_watch(body: WatchIn, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    conn.execute(
        "INSERT INTO watchlist (user_id, ticker, name, target_price, note) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET"
        " name = excluded.name, target_price = excluded.target_price, note = excluded.note",
        (uid, body.ticker, body.name, body.target_price, body.note),
    )
    conn.commit()
    return one(
        conn.execute("SELECT * FROM watchlist WHERE user_id = ? AND ticker = ?", (uid, body.ticker))
    )


@app.get("/watchlist")
def list_watch(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    latest = _latest_prices(conn, uid)
    items = rows(conn.execute("SELECT * FROM watchlist WHERE user_id = ? ORDER BY ticker", (uid,)))
    for w in items:
        w["price"] = latest.get(w["ticker"])
        t = w["target_price"]
        w["pct_to_target"] = (
            (t - w["price"]) / w["price"] * 100 if t is not None and w["price"] else None
        )
    return items


@app.patch("/watchlist/{item_id}")
def patch_watch(
    item_id: int, body: WatchPatch, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    if not one(conn.execute("SELECT id FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid))):
        raise HTTPException(404, "Watchlist item not found")
    changes = body.model_dump(exclude_unset=True)
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(
            f"UPDATE watchlist SET {sets} WHERE id = ? AND user_id = ?", (*changes.values(), item_id, uid)
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
    return rows(
        conn.execute(
            "SELECT p.* FROM prices p WHERE p.id = ("
            f" SELECT id FROM prices WHERE ticker = p.ticker AND {PRICE_VISIBLE}"
            " ORDER BY as_of DESC, id DESC LIMIT 1)"
            " AND (p.user_id = ? OR p.user_id IS NULL)"
            " ORDER BY p.ticker",
            (uid, uid),
        )
    )


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
    return asdict(_summary(conn, uid))


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
