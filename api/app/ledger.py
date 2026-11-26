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


def all_trades(conn, user_id: int) -> list[dict]:
    return rows(
        conn.execute("SELECT * FROM trades WHERE user_id = ? ORDER BY traded_at, id", (user_id,))
    )


def positions(trades: list[dict]) -> dict[str, Position]:
    """Positions for a read path. An already-inconsistent ledger is a clear 409, not a 500."""
    try:
        return compute_positions(to_trade(r) for r in trades)
    except OversellError as e:
        raise HTTPException(409, f"Trade history is inconsistent: {e}. Fix or delete that trade.")


# A price mark is visible to its owner, and to everyone when it came from a market-data provider
# (user_id NULL). Never drop this filter: it is what keeps one user's manual marks private.
PRICE_VISIBLE = "(user_id = ? OR user_id IS NULL)"


# Which mark is "latest" for a ticker: the newest day wins; on the same day the user's own manual
# mark beats a market one (they typed it on purpose); then the most recently saved.
_LATEST_ORDER = "as_of DESC, (user_id IS NULL) ASC, id DESC"


def latest_marks(conn, user_id: int) -> dict[str, dict]:
    """Newest visible mark per ticker: {ticker: full price row}."""
    return {
        r["ticker"]: r
        for r in rows(
            conn.execute(
                "SELECT p.* FROM prices p"
                " WHERE (p.user_id = ? OR p.user_id IS NULL) AND p.id = ("
                f" SELECT id FROM prices WHERE ticker = p.ticker AND {PRICE_VISIBLE}"
                f" ORDER BY {_LATEST_ORDER} LIMIT 1)",
                (user_id, user_id),
            )
        )
    }


def latest_prices(conn, user_id: int) -> dict[str, float]:
    """Newest visible price per ticker (same rule as GET /prices)."""
    return {t: m["price"] for t, m in latest_marks(conn, user_id).items()}


def price_kind(source: str | None) -> str:
    """How a price should be described to the user: typed by hand, or from the market."""
    return "manual" if source in (None, "manual") else "market"


def meta(conn, user_id: int) -> dict[str, dict]:
    return {
        r["ticker"]: r
        for r in rows(conn.execute("SELECT * FROM holdings WHERE user_id = ?", (user_id,)))
    }


def summary(conn, user_id: int) -> Summary:
    return build_summary(
        positions(all_trades(conn, user_id)), latest_prices(conn, user_id), meta(conn, user_id)
    )


def holding_for(conn, user_id: int, ticker: str) -> Holding | None:
    return next((h for h in summary(conn, user_id).holdings if h.ticker == ticker), None)


def watchlist_name(conn, user_id: int, ticker: str) -> str | None:
    r = one(
        conn.execute(
            "SELECT name FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, ticker)
        )
    )
    return (r or {}).get("name") or None
