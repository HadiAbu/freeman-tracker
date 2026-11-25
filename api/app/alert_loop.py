"""Runs the price alert check in the background for as long as the server is up."""

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from app.alerts import run_check
from app.config import Settings
from app.mailer import SmtpMailer
from app.market_routes import get_quote_cache
from app.quotes import FinnhubQuotes

log = logging.getLogger("freeman.alerts")


def start_alert_loop(
    settings: Settings, open_conn: Callable[[], Any], stop: threading.Event
) -> threading.Thread | None:
    """Starts the checker thread, or returns None (after one log line) when alerts cannot work.

    Each cycle opens its own database connection and closes it, so the thread never shares a
    connection with request handlers. Setting `stop` ends the loop within one wait.
    """
    if not settings.finnhub_api_key:
        log.info("price alerts are off: FINNHUB_API_KEY is not set")
        return None
    if not settings.email_configured:
        log.info("price alerts are off: SMTP_USER and SMTP_PASSWORD are not set")
        return None

    quotes = FinnhubQuotes(settings.finnhub_api_key, timeout=settings.quote_timeout_seconds)
    mailer = SmtpMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        password=settings.smtp_password,
        sender=settings.email_sender,
    )
    cache = get_quote_cache(settings)

    def loop() -> None:
        log.info("price alerts are on: checking every %s seconds", settings.alert_check_seconds)
        while not stop.is_set():
            try:
                conn = open_conn()
                try:
                    result = run_check(
                        conn, quotes, cache, mailer, datetime.now(timezone.utc),
                        cooldown_seconds=settings.alert_cooldown_seconds,
                    )
                finally:
                    close = getattr(conn, "close", None)
                    if close:
                        close()
                if result.sent or result.failed_emails:
                    log.info("price alerts: %s sent, %s failed", result.sent, result.failed_emails)
            except Exception:  # one bad cycle must never end the checker
                log.exception("price alert check failed")
            stop.wait(settings.alert_check_seconds)

    thread = threading.Thread(target=loop, name="price-alerts", daemon=True)
    thread.start()
    return thread
