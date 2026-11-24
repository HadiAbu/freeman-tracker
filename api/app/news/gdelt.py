import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from app.news.models import NewsItem, NewsSourceError
from app.news.normalize import canonical_url, clean_text, item_id

BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# GDELT asks for at most one request every 5 seconds. The limit is process-wide.
_lock = threading.Lock()
_last_call: float | None = None


def reset_throttle() -> None:
    """Forget the last call time (tests only)."""
    global _last_call
    _last_call = None


def parse_seendate(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


class GdeltClient:
    def __init__(
        self,
        *,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
        clock=time.monotonic,
        sleep=time.sleep,
        min_interval: float = 5.0,
    ):
        self._timeout = timeout
        self._transport = transport
        self._clock = clock
        self._sleep = sleep
        self._min_interval = min_interval

    def _wait_turn(self) -> None:
        # The lock covers only the wait/timestamp bookkeeping, never the HTTP request.
        global _last_call
        with _lock:
            now = self._clock()
            if _last_call is not None:
                remaining = self._min_interval - (now - _last_call)
                if remaining > 0:
                    self._sleep(remaining)
                    now = self._clock()
            _last_call = now

    def articles(self, query: str, *, timespan: str = "3d", max_records: int = 12) -> list[NewsItem]:
        self._wait_turn()
        params = {
            "query": query, "mode": "artlist", "format": "json",
            "maxrecords": str(max_records), "timespan": timespan, "sort": "datedesc",
        }
        # Failures are recorded inside the except blocks (class name only) and raised
        # after leaving them, so the raised error carries no __context__.
        failure: str | None = None
        response = None
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(BASE_URL, params=params)
        except (httpx.HTTPError, httpx.InvalidURL) as e:
            failure = type(e).__name__
        if failure is not None:
            raise NewsSourceError("gdelt", failure)
        if response.status_code == 429:
            raise NewsSourceError("gdelt", "rate limited")
        if response.status_code != 200:
            raise NewsSourceError("gdelt", f"HTTP {response.status_code}")

        data = None
        bad_json = False
        try:
            data = response.json()  # a throttled or errored reply is plain text, not JSON
        except ValueError:
            bad_json = True
        if bad_json or not isinstance(data, dict):
            raise NewsSourceError("gdelt", "unexpected response")
        raw_articles = data.get("articles")
        if raw_articles is None:
            return []
        if not isinstance(raw_articles, list):
            raise NewsSourceError("gdelt", "unexpected response")

        out: list[NewsItem] = []
        for raw in raw_articles:
            if not isinstance(raw, dict):
                continue
            raw_url, raw_title, raw_domain = raw.get("url"), raw.get("title"), raw.get("domain")
            if not isinstance(raw_url, str) or not isinstance(raw_title, str):
                continue
            url = canonical_url(raw_url)
            title = clean_text(raw_title, 200)
            if not url or not title:
                continue
            domain = (clean_text(raw_domain, 60) if isinstance(raw_domain, str) else "") or urlsplit(url).netloc
            try:
                out.append(
                    NewsItem(
                        id=item_id(url), title=title, source=domain,
                        published_at=parse_seendate(raw.get("seendate")), url=url,
                        snippet="", origin="gdelt",
                    )
                )
            except ValueError:
                continue
        return out
