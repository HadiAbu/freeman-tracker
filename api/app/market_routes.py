import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app import ledger
from app.auth import current_user_id
from app.config import Settings, get_settings
from app.db import get_conn, rows
from app.portfolio import OversellError, compute_positions
from app.quotes import FinnhubQuotes, QuoteCache, QuoteError, QuoteProvider

router = APIRouter(prefix="/prices", tags=["market prices"])

MAX_TICKERS = 50  # Finnhub's free tier allows 60 calls a minute
BUDGET_SECONDS = 20.0  # stop asking the provider after this long; the rest are reported as failed

_cache: QuoteCache | None = None


def get_quote_cache(settings: Settings = Depends(get_settings)) -> QuoteCache:
    global _cache
    if _cache is None:
        _cache = QuoteCache(settings.price_cache_seconds)
    return _cache


def reset_quote_cache() -> None:
    global _cache
    _cache = None


def get_quote_provider(settings: Settings = Depends(get_settings)) -> QuoteProvider:
    if not settings.finnhub_api_key:
        raise HTTPException(503, "Market prices are not configured: set FINNHUB_API_KEY in api/.env.")
    return FinnhubQuotes(settings.finnhub_api_key, timeout=settings.quote_timeout_seconds)


def _tickers_to_refresh(conn, user_id: int) -> list[str]:
    """Open positions first (they drive the portfolio value), then the watchlist."""
    trades = ledger.all_trades(conn, user_id)
    try:
        held = [p.ticker for p in compute_positions(ledger.to_trade(r) for r in trades).values() if p.shares > 1e-9]
    except OversellError:
        # An inconsistent ledger must not block refreshing prices: fall back to everything traded.
        held = sorted({r["ticker"] for r in trades})
    watched = [r["ticker"] for r in rows(conn.execute("SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY ticker", (user_id,)))]
    seen: dict[str, None] = {}
    for t in [*held, *watched]:
        seen.setdefault(t, None)
    return list(seen)[:MAX_TICKERS]


def _store(conn, quote) -> None:
    """One shared (user_id NULL) mark per ticker per day: a later refresh the same day updates it
    instead of piling up rows, so the history chart gets one point per day."""
    day = quote.as_of.isoformat()
    cur = conn.execute(
        "UPDATE prices SET price = ?, source = 'market' WHERE user_id IS NULL AND ticker = ? AND as_of = ?",
        (quote.price, quote.ticker, day),
    )
    if cur.rowcount == 0:
        conn.execute(
            "INSERT INTO prices (user_id, ticker, price, as_of, source) VALUES (NULL, ?, ?, ?, 'market')",
            (quote.ticker, quote.price, day),
        )


@router.post("/refresh")
def refresh_prices(
    user_id: int = Depends(current_user_id),
    conn=Depends(get_conn),
    provider: QuoteProvider = Depends(get_quote_provider),
    cache: QuoteCache = Depends(get_quote_cache),
):
    """Fetch current market prices for the caller's holdings and watchlist.

    A provider outage is not an error: tickers that could not be fetched are listed in `failed` and
    keep their last known price. Only a missing configuration is a 503.
    """
    started = time.monotonic()
    updated: list[dict] = []
    failed: list[dict] = []
    from_cache = 0

    for ticker in _tickers_to_refresh(conn, user_id):
        quote = cache.get(ticker)
        if quote is not None:
            from_cache += 1
        elif time.monotonic() - started > BUDGET_SECONDS:
            failed.append({"ticker": ticker, "reason": "skipped: taking too long"})
            continue
        else:
            try:
                quote = provider.quote(ticker)
            except QuoteError as e:
                failed.append({"ticker": ticker, "reason": str(e)})
                continue
            cache.put(quote)
            _store(conn, quote)
        updated.append({"ticker": ticker, "price": quote.price, "as_of": quote.as_of.isoformat()})

    conn.commit()
    return {
        "updated": updated,
        "failed": failed,
        "from_cache": from_cache,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
