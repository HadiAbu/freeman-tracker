from datetime import date

import httpx
import pytest

from app.quotes import FinnhubQuotes, Quote, QuoteCache


def finnhub(payload):
    return FinnhubQuotes("k", transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))


def test_a_quote_carries_the_previous_close():
    q = finnhub({"c": 190.5, "pc": 188.0, "t": 0}).quote("AAPL")
    assert q.price == 190.5 and q.previous_close == 188.0


@pytest.mark.parametrize("pc", [0, -1, None, "188", True])
def test_a_missing_or_bad_previous_close_is_none_and_the_quote_still_works(pc):
    q = finnhub({"c": 190.5, "pc": pc, "t": 0}).quote("AAPL")
    assert q.price == 190.5 and q.previous_close is None


def test_cache_get_can_refuse_entries_older_than_max_age():
    now = [0.0]
    cache = QuoteCache(120, clock=lambda: now[0])
    cache.put(Quote("AAPL", 1.0, date(2026, 1, 1)))
    now[0] = 59
    assert cache.get("AAPL", max_age=60) is not None
    now[0] = 61
    assert cache.get("AAPL", max_age=60) is None  # too old for the checker
    assert cache.get("AAPL") is not None  # still within the normal 120 s ttl
    now[0] = 121
    assert cache.get("AAPL") is None
