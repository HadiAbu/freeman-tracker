import threading
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.analysis.routes import router as analysis_router
from app.auth import require_api_key
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

auth = [Depends(require_api_key)]
app.include_router(analysis_router)


@app.get("/health")
def health():
    return {"ok": True}


# ---------- helpers ----------
# One writer at a time for anything that checks the ledger and then writes it. Without this,
# two concurrent requests can both pass the oversell check and together break the invariant.
# It covers a single server process (how this app is deployed); a multi-process deployment
# would need a database-level guard instead.
_write_lock = threading.Lock()


def _check(trades: list[dict]) -> None:
    """Reject any change that would leave a sell larger than the shares held."""
    try:
        compute_positions(_to_trade(r) for r in trades)
    except OversellError as e:
        raise HTTPException(409, str(e))


# ---------- trades ----------
@app.post("/trades", status_code=201, dependencies=auth)
def create_trade(body: TradeIn, conn=Depends(get_conn)):
    new = {**body.model_dump(), "traded_at": body.traded_at.isoformat(), "id": 10**12}
    with _write_lock:
        _check(_all_trades(conn) + [new])
        cur = conn.execute(
            "INSERT INTO trades (ticker, side, shares, price, fee, traded_at, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.ticker, body.side, body.shares, body.price, body.fee, new["traded_at"], body.note),
        )
        conn.commit()
    return one(conn.execute("SELECT * FROM trades WHERE id = ?", (cur.lastrowid,)))


@app.get("/trades", dependencies=auth)
def list_trades(
    ticker: str | None = None,
    side: Literal["buy", "sell"] | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
):
    """Newest first. Page with limit/offset; a page shorter than `limit` is the last one."""
    sql, args = "SELECT * FROM trades WHERE user_id = 1", []
    if ticker:
        sql += " AND ticker = ?"
        args.append(ticker.upper())
    if side:
        sql += " AND side = ?"
        args.append(side)
    sql += " ORDER BY traded_at DESC, id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    return rows(conn.execute(sql, args))


@app.patch("/trades/{trade_id}", dependencies=auth)
def patch_trade(trade_id: int, body: TradePatch, conn=Depends(get_conn)):
    with _write_lock:
        current = one(
            conn.execute("SELECT * FROM trades WHERE id = ? AND user_id = 1", (trade_id,))
        )
        if not current:
            raise HTTPException(404, "Trade not found")
        changes = body.model_dump(exclude_unset=True)
        if changes.get("traded_at") is not None:
            changes["traded_at"] = changes["traded_at"].isoformat()
        # null clears only the optional note; other fields cannot be nulled
        changes = {k: v for k, v in changes.items() if v is not None or k == "note"}
        updated = {**current, **changes}
        _check([updated if r["id"] == trade_id else r for r in _all_trades(conn)])
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(f"UPDATE trades SET {sets} WHERE id = ?", (*changes.values(), trade_id))
            conn.commit()
    return one(conn.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)))


@app.delete("/trades/{trade_id}", status_code=204, dependencies=auth)
def delete_trade(trade_id: int, conn=Depends(get_conn)):
    with _write_lock:
        if not one(conn.execute("SELECT id FROM trades WHERE id = ? AND user_id = 1", (trade_id,))):
            raise HTTPException(404, "Trade not found")
        _check([r for r in _all_trades(conn) if r["id"] != trade_id])
        conn.execute("DELETE FROM trades WHERE id = ?", (trade_id,))
        conn.commit()


# ---------- watchlist ----------
@app.post("/watchlist", status_code=201, dependencies=auth)
def add_watch(body: WatchIn, conn=Depends(get_conn)):
    conn.execute(
        "INSERT INTO watchlist (ticker, name, target_price, note) VALUES (?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET"
        " name = excluded.name, target_price = excluded.target_price, note = excluded.note",
        (body.ticker, body.name, body.target_price, body.note),
    )
    conn.commit()
    return one(
        conn.execute("SELECT * FROM watchlist WHERE user_id = 1 AND ticker = ?", (body.ticker,))
    )


@app.get("/watchlist", dependencies=auth)
def list_watch(conn=Depends(get_conn)):
    latest = _latest_prices(conn)
    items = rows(conn.execute("SELECT * FROM watchlist WHERE user_id = 1 ORDER BY ticker"))
    for w in items:
        w["price"] = latest.get(w["ticker"])
        t = w["target_price"]
        w["pct_to_target"] = (
            (t - w["price"]) / w["price"] * 100 if t is not None and w["price"] else None
        )
    return items


@app.patch("/watchlist/{item_id}", dependencies=auth)
def patch_watch(item_id: int, body: WatchPatch, conn=Depends(get_conn)):
    if not one(conn.execute("SELECT id FROM watchlist WHERE id = ? AND user_id = 1", (item_id,))):
        raise HTTPException(404, "Watchlist item not found")
    changes = body.model_dump(exclude_unset=True)
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(f"UPDATE watchlist SET {sets} WHERE id = ?", (*changes.values(), item_id))
        conn.commit()
    return one(conn.execute("SELECT * FROM watchlist WHERE id = ?", (item_id,)))


@app.delete("/watchlist/{item_id}", status_code=204, dependencies=auth)
def delete_watch(item_id: int, conn=Depends(get_conn)):
    if not one(conn.execute("SELECT id FROM watchlist WHERE id = ? AND user_id = 1", (item_id,))):
        raise HTTPException(404, "Watchlist item not found")
    conn.execute("DELETE FROM watchlist WHERE id = ?", (item_id,))
    conn.commit()


# ---------- prices ----------
@app.post("/prices", status_code=201, dependencies=auth)
def add_price(body: PriceIn, conn=Depends(get_conn)):
    cur = conn.execute(
        "INSERT INTO prices (ticker, price, as_of, source) VALUES (?, ?, ?, ?)",
        (body.ticker, body.price, body.as_of.isoformat(), body.source),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM prices WHERE id = ?", (cur.lastrowid,)))


@app.get("/prices", dependencies=auth)
def latest_prices(conn=Depends(get_conn)):
    return rows(
        conn.execute(
            "SELECT p.* FROM prices p WHERE p.id = ("
            " SELECT id FROM prices WHERE ticker = p.ticker ORDER BY as_of DESC, id DESC LIMIT 1)"
            " ORDER BY p.ticker"
        )
    )


@app.get("/prices/{ticker}", dependencies=auth)
def price_history(ticker: str, conn=Depends(get_conn)):
    return rows(
        conn.execute("SELECT * FROM prices WHERE ticker = ? ORDER BY as_of, id", (ticker.upper(),))
    )


# ---------- holding metadata (name / sector / asset class for allocation pies) ----------
@app.put("/holdings/{ticker}", dependencies=auth)
def put_holding(ticker: str, body: HoldingMeta, conn=Depends(get_conn)):
    t = ticker.strip().upper()
    conn.execute(
        "INSERT INTO holdings (ticker, name, sector, asset_class) VALUES (?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET"
        " name = excluded.name, sector = excluded.sector, asset_class = excluded.asset_class",
        (t, body.name, body.sector, body.asset_class),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM holdings WHERE user_id = 1 AND ticker = ?", (t,)))


_HOLDING_COLUMNS = ("name", "sector", "asset_class")  # fixed whitelist for PATCH


@app.patch("/holdings/{ticker}", dependencies=auth)
def patch_holding(ticker: str, body: HoldingMeta, conn=Depends(get_conn)):
    """Partial update: only fields present in the body change; an explicit null clears."""
    t = ticker.strip().upper()
    changes = body.model_dump(exclude_unset=True)
    cols = [c for c in _HOLDING_COLUMNS if c in changes]
    if not cols:
        raise HTTPException(status_code=422, detail="nothing to update")
    conn.execute("INSERT OR IGNORE INTO holdings (ticker) VALUES (?)", (t,))
    sets = ", ".join(f"{c} = ?" for c in cols)  # column names come from the whitelist only
    conn.execute(
        f"UPDATE holdings SET {sets} WHERE user_id = 1 AND ticker = ?",
        (*[changes[c] for c in cols], t),
    )
    conn.commit()
    return one(conn.execute("SELECT * FROM holdings WHERE user_id = 1 AND ticker = ?", (t,)))


# ---------- portfolio (derived, chart-ready) ----------
@app.get("/portfolio/summary", dependencies=auth)
def portfolio_summary(conn=Depends(get_conn)):
    return asdict(_summary(conn))


@app.get("/portfolio/allocation", dependencies=auth)
def portfolio_allocation(
    by: Literal["ticker", "sector", "asset_class"] = "ticker", conn=Depends(get_conn)
):
    trades = _all_trades(conn)
    positions = _positions(trades)
    meta = _meta(conn)
    summary = build_summary(positions, _latest_prices(conn), meta)
    # `slot` identity comes from every ticker ever traded (closed ones too), so colors on the
    # client do not shift when a position is opened, resized or closed.
    return allocation(summary, by, first_trade_order(_to_trade(r) for r in trades), meta)


@app.get("/portfolio/history", dependencies=auth)
def portfolio_history(conn=Depends(get_conn)):
    trades = _all_trades(conn)
    _positions(trades)  # surfaces an inconsistent ledger as a clear 409 before the history pass
    points = [
        (r["ticker"], date.fromisoformat(r["as_of"]), r["price"])
        for r in rows(conn.execute("SELECT ticker, as_of, price FROM prices ORDER BY as_of, id"))
    ]
    return value_history((_to_trade(r) for r in trades), points)
