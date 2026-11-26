"""Market quotes: a provider interface, the Finnhub implementation, and a short in-memory cache."""

import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol

import httpx

# Finnhub takes its token as a query parameter, so no HTTP client may ever log request URLs.
for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).setLevel(logging.WARNING)

BASE_URL = "https://finnhub.io/api/v1"


class QuoteError(Exception):
    """A quote could not be had. The message is safe to show: it never carries a URL or a key."""


@dataclass(frozen=True)
class Quote:
    ticker: str
    price: float
    as_of: date  # the day of the last trade, so a weekend refresh reports Friday
    previous_close: float | None = None  # yesterday's close; None when the provider sent none


class QuoteProvider(Protocol):
    def quote(self, ticker: str) -> Quote: ...


def _trade_day(ts, today: date) -> date:
    """UTC day of a Unix timestamp; today when it is missing or implausible. Never in the future."""
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or not math.isfinite(ts) or ts <= 0:
        return today
    try:
        day = datetime.fromtimestamp(ts, tz=timezone.utc).date()
    except (OverflowError, OSError, ValueError):
        return today
    return min(day, today)


class FinnhubQuotes:
    def __init__(
        self, api_key: str, *, timeout: float = 5.0, transport: httpx.BaseTransport | None = None
    ):
        self._key = api_key
        self._timeout = timeout
        self._transport = transport

    def quote(self, ticker: str) -> Quote:
        # The original httpx error can carry the URL, token included, so only its class name is
        # kept and the new error is raised outside the except block (no __context__).
        failure: str | None = None
        response = None
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(
                    f"{BASE_URL}/quote", params={"symbol": ticker, "token": self._key}
                )
        except httpx.HTTPError as e:
            failure = type(e).__name__
        if failure is not None:
            raise QuoteError(f"provider unreachable ({failure})")
        if response.status_code == 429:
            raise QuoteError("provider rate limit reached")
        if response.status_code != 200:
            raise QuoteError(f"provider error (HTTP {response.status_code})")
        try:
            data = response.json()
        except ValueError:
            raise QuoteError("provider sent an unreadable reply") from None

        price = data.get("c") if isinstance(data, dict) else None
        # Finnhub answers 200 with all zeros for a symbol it does not know.
        if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
            raise QuoteError("no quote for this symbol")
        today = datetime.now(timezone.utc).date()
        pc = data.get("pc")
        previous = (
            float(pc)
            if isinstance(pc, (int, float)) and not isinstance(pc, bool) and math.isfinite(pc) and pc > 0
            else None
        )
        return Quote(ticker, float(price), _trade_day(data.get("t"), today), previous)


class QuoteCache:
    """Remembers quotes for `ttl` seconds, shared by every user (market data is not personal).
    Keeps a free-tier provider limit safe when several people refresh at once."""

    def __init__(self, ttl: float, clock=time.monotonic):
        self.ttl = ttl
        self._clock = clock
        self._items: dict[str, tuple[float, Quote]] = {}
        self._lock = threading.Lock()

    def get(self, ticker: str, max_age: float | None = None) -> Quote | None:
        """The cached quote, if younger than the ttl (and than `max_age`, when given)."""
        limit = self.ttl if max_age is None else min(self.ttl, max_age)
        with self._lock:
            hit = self._items.get(ticker)
            if hit and self._clock() - hit[0] < limit:
                return hit[1]
            return None

    def put(self, quote: Quote) -> None:
        with self._lock:
            self._items[quote.ticker] = (self._clock(), quote)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
