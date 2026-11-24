"""Read-side helpers for the trade ledger, shared by the portfolio and analysis routes."""

from datetime import date

from fastapi import HTTPException

from app.db import one, rows
from app.portfolio import (
    Holding,
    OversellError,
    Position,
    Summary,
    Trade,
    build_summary,
    compute_positions,
)


def to_trade(r: dict) -> Trade:
    return Trade(
        r["id"], r["ticker"], r["side"], r["shares"], r["price"], r["fee"],
        date.fromisoformat(r["traded_at"]),
    )


def all_trades(conn) -> list[dict]:
    return rows(conn.execute("SELECT * FROM trades WHERE user_id = 1 ORDER BY traded_at, id"))


def positions(trades: list[dict]) -> dict[str, Position]:
    """Positions for a read path. An already-inconsistent ledger is a clear 409, not a 500."""
    try:
        return compute_positions(to_trade(r) for r in trades)
    except OversellError as e:
        raise HTTPException(409, f"Trade history is inconsistent: {e}. Fix or delete that trade.")


def latest_prices(conn) -> dict[str, float]:
    """Newest mark per ticker, computed in SQL (same rule as GET /prices)."""
    return {
        r["ticker"]: r["price"]
        for r in rows(
            conn.execute(
                "SELECT p.ticker, p.price FROM prices p WHERE p.id = ("
                " SELECT id FROM prices WHERE ticker = p.ticker ORDER BY as_of DESC, id DESC LIMIT 1)"
            )
        )
    }


def meta(conn) -> dict[str, dict]:
    return {r["ticker"]: r for r in rows(conn.execute("SELECT * FROM holdings WHERE user_id = 1"))}


def summary(conn) -> Summary:
    return build_summary(positions(all_trades(conn)), latest_prices(conn), meta(conn))


def holding_for(conn, ticker: str) -> Holding | None:
    return next((h for h in summary(conn).holdings if h.ticker == ticker), None)


def watchlist_name(conn, ticker: str) -> str | None:
    r = one(conn.execute("SELECT name FROM watchlist WHERE user_id = 1 AND ticker = ?", (ticker,)))
    return (r or {}).get("name") or None
