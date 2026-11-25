"""Price alerts: when a limit counts as reached, and what state a limit starts in."""

import logging
import time
from dataclasses import dataclass
from datetime import datetime

from app.alert_email import AlertDetails, compose
from app.db import rows
from app.mailer import MailError, Mailer
from app.market_routes import _store as store_market_price
from app.quotes import Quote, QuoteCache, QuoteError, QuoteProvider

log = logging.getLogger("freeman.alerts")

MAX_TICKERS = 50  # Finnhub's free tier allows 60 calls a minute
QUOTE_MAX_AGE = 60.0  # a cached quote older than this is not trusted for an alert
BUDGET_SECONDS = 90.0  # stop asking the provider after this long in one cycle

ARMED = "armed"  # will email the next time the price reaches the limit
TRIGGERED = "triggered"  # already past the limit; quiet until the price crosses back


def beyond(side: str, price: float, limit: float) -> bool:
    """True when `price` has reached `limit`. Reaching it counts: >= for upper, <= for lower."""
    return price >= limit if side == "upper" else price <= limit


def initial_state(side: str, price: float | None, limit: float | None) -> str:
    """State for a limit that was just created or changed.

    A limit the price is already past starts 'triggered', so setting it never sends an email about
    something that was already true. It emails only after the price comes back and crosses again.
    """
    if limit is None or price is None:
        return ARMED
    return TRIGGERED if beyond(side, price, limit) else ARMED


def decide(
    side: str,
    state: str,
    price: float,
    limit: float,
    last_alerted_at: datetime | None,
    now: datetime,
    cooldown_seconds: int,
) -> str:
    """What to do with one limit this cycle: "send" an email, "rearm" it, or do "none".

    Fire once: an armed limit emails when reached; a triggered one stays quiet while the price is
    beyond it and re-arms when the price is back inside. The cooldown stops a price flickering
    around a limit from emailing every cycle.
    """
    is_beyond = beyond(side, price, limit)
    if state == TRIGGERED:
        return "none" if is_beyond else "rearm"
    if not is_beyond:
        return "none"
    if last_alerted_at is not None and (now - last_alerted_at).total_seconds() < cooldown_seconds:
        return "none"
    return "send"


@dataclass
class CheckResult:
    sent: int = 0
    failed_emails: int = 0
    waiting_for_destination: int = 0  # reached, but no address (or no mail server) to send to
    quote_failures: int = 0
    rearmed: int = 0
    skipped_tickers: int = 0  # over MAX_TICKERS, not checked this cycle


def _details(item: dict, side: str, quote: Quote, now: datetime, cooldown_seconds: int) -> AlertDetails:
    last_trade = quote.as_of.isoformat()
    return AlertDetails(
        ticker=item["ticker"],
        name=item["name"],
        side=side,
        price=quote.price,
        limit=item[f"{side}_limit"],
        upper_limit=item["upper_limit"],
        lower_limit=item["lower_limit"],
        previous_close=quote.previous_close,
        note=item["note"],
        checked_at=now.strftime("%Y-%m-%d %H:%M UTC"),
        last_trade_day=None if last_trade == now.date().isoformat() else last_trade,
        cooldown_seconds=cooldown_seconds,
    )


def run_check(
    conn,
    quotes: QuoteProvider,
    cache: QuoteCache,
    mailer: Mailer | None,
    now: datetime,
    *,
    cooldown_seconds: int,
    max_emails: int = 20,
) -> CheckResult:
    """One pass over every watchlist limit, for every user. `now` must be timezone-aware UTC.

    Quotes each distinct ticker once, saves the price as today's shared market price (so the app is
    fresh too), then applies `decide` to each limit. A failed quote or email never loses an alert:
    the limit simply stays armed and the next cycle tries again.
    """
    result = CheckResult()
    items = rows(
        conn.execute(
            "SELECT w.*, u.alert_email FROM watchlist w JOIN users u ON u.id = w.user_id"
            " WHERE w.upper_limit IS NOT NULL OR w.lower_limit IS NOT NULL ORDER BY w.ticker, w.id"
        )
    )

    fetched: dict[str, Quote] = {}
    from_provider: list[Quote] = []  # saved after the loop, so no write is open while we wait
    started = time.monotonic()
    tickers = list(dict.fromkeys(i["ticker"] for i in items))
    result.skipped_tickers = max(0, len(tickers) - MAX_TICKERS)
    if result.skipped_tickers:
        log.warning(
            "price alerts: %s tickers over the %s cap were not checked", result.skipped_tickers, MAX_TICKERS
        )
    for ticker in tickers[:MAX_TICKERS]:
        quote = cache.get(ticker, max_age=QUOTE_MAX_AGE)
        if quote is None:
            if time.monotonic() - started > BUDGET_SECONDS:
                result.quote_failures += 1
                continue
            try:
                quote = quotes.quote(ticker)
            except QuoteError as e:
                log.warning("price alerts: no quote for %s (%s)", ticker, e)
                result.quote_failures += 1
                continue
            cache.put(quote)
            from_provider.append(quote)
        fetched[ticker] = quote

    # A write transaction must never stay open across network I/O (quotes or mail): until it ends,
    # every other writer fails with "database is locked". So: one short burst, then commit.
    for quote in from_provider:
        store_market_price(conn, quote)
    conn.commit()

    emails = 0
    for item in items:
        quote = fetched.get(item["ticker"])
        if quote is None:
            continue
        last = datetime.fromisoformat(item["last_alerted_at"]) if item["last_alerted_at"] else None
        for side in ("upper", "lower"):
            limit = item[f"{side}_limit"]
            if limit is None:
                continue
            action = decide(side, item[f"{side}_state"], quote.price, limit, last, now, cooldown_seconds)
            if action == "rearm":
                cur = conn.execute(
                    f"UPDATE watchlist SET {side}_state = 'armed'"
                    f" WHERE id = ? AND {side}_limit = ? AND {side}_state = 'triggered'",
                    (item["id"], limit),
                )
                conn.commit()  # a later send must not run with this write still open
                result.rearmed += 1 if cur.rowcount == 1 else 0  # 0: edited meanwhile, leave it
            elif action == "send":
                if not item["alert_email"] or mailer is None:
                    result.waiting_for_destination += 1
                    continue
                if emails >= max_emails:
                    continue  # stays armed; the next cycle sends it
                subject, body = compose(_details(item, side, quote, now, cooldown_seconds))
                try:
                    mailer.send(item["alert_email"], subject, body)
                except MailError as e:
                    log.warning("price alerts: %s", e)
                    result.failed_emails += 1
                    continue
                emails += 1
                result.sent += 1
                conn.execute(  # no match means the limit changed meanwhile: leave that change alone
                    f"UPDATE watchlist SET {side}_state = 'triggered', last_alerted_at = ?"
                    f" WHERE id = ? AND {side}_limit = ? AND {side}_state = 'armed'",
                    (now.isoformat(), item["id"], limit),
                )
                # Commit now: if a later send raises something unexpected, this email must not be
                # re-sent every cycle because its state was never saved.
                conn.commit()
    return result
