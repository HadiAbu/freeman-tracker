import logging
import math
from datetime import date, datetime, timedelta, timezone

import httpx

from app.news.models import NewsItem, NewsSourceError, Origin
from app.news.normalize import canonical_url, clean_text, item_id

# Finnhub takes its token as a query parameter, so no HTTP client may ever log request URLs.
for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).setLevel(logging.WARNING)

BASE_URL = "https://finnhub.io/api/v1"


def _published_at(ts) -> datetime | None:
    """UTC time for a Unix timestamp, or None. Bools, non-numbers, non-finite, non-positive and out-of-range values give None."""
    if isinstance(ts, bool) or not isinstance(ts, (int, float)):
        return None
    if not math.isfinite(ts) or ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


class FinnhubClient:
    def __init__(self, api_key: str, *, timeout: float = 10.0, transport: httpx.BaseTransport | None = None):
        self._key = api_key
        self._timeout = timeout
        self._transport = transport

    def _get(self, path: str, params: dict):
        # The original httpx error can carry the full URL, token included. Record only its class name
        # inside the except block and raise after it, so the new error has no __context__ either.
        failure: str | None = None
        response = None
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(f"{BASE_URL}{path}", params={**params, "token": self._key})
        except httpx.HTTPError as e:
            failure = type(e).__name__
        if failure is not None:
            raise NewsSourceError("finnhub", failure)
        if response.status_code != 200:
            raise NewsSourceError("finnhub", f"HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError:
            pass
        raise NewsSourceError("finnhub", "invalid JSON")

    @staticmethod
    def _items(data, origin: Origin) -> list[NewsItem]:
        if not isinstance(data, list):
            raise NewsSourceError("finnhub", "unexpected response")
        out: list[NewsItem] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            url = canonical_url(str(raw.get("url") or ""))
            title = clean_text(raw.get("headline"), 200)
            if not url or not title:
                continue
            out.append(
                NewsItem(
                    id=item_id(url), title=title,
                    source=clean_text(raw.get("source"), 60) or "Unknown",
                    published_at=_published_at(raw.get("datetime")), url=url,
                    snippet=clean_text(raw.get("summary"), 300), origin=origin,
                )
            )
        return out

    def company_news(self, symbol: str, today: date, days: int = 7) -> list[NewsItem]:
        data = self._get(
            "/company-news",
            {"symbol": symbol, "from": (today - timedelta(days=days)).isoformat(), "to": today.isoformat()},
        )
        return self._items(data, "finnhub_company")

    def market_news(self) -> list[NewsItem]:
        return self._items(self._get("/news", {"category": "general"}), "finnhub_market")

    def profile(self, symbol: str) -> dict:
        data = self._get("/stock/profile2", {"symbol": symbol})
        if not isinstance(data, dict):
            raise NewsSourceError("finnhub", "unexpected response")
        return {
            "name": clean_text(data.get("name"), 80) or None,
            "industry": clean_text(data.get("finnhubIndustry"), 80) or None,
        }
