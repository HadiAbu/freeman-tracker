import json
import logging
from datetime import date, datetime, timezone

import httpx
import pytest

from app.news.finnhub import FinnhubClient
from app.news.models import NewsSourceError

TOKEN = "tok-SECRET-123"


def client_for(handler):
    return FinnhubClient(TOKEN, transport=httpx.MockTransport(handler))


NEWS = [
    {"category": "company", "datetime": 1763380800, "headline": "Apple <b>beats</b> estimates",
     "id": 1, "image": "", "related": "AAPL", "source": "Reuters",
     "summary": "<p>Strong &amp; steady quarter.</p>", "url": "https://example.com/a?utm_source=x"},
    {"datetime": 1763380900, "headline": "Bad link", "source": "X", "summary": "", "url": "javascript:alert(1)"},
    {"datetime": 1763380900, "headline": "", "source": "X", "summary": "", "url": "https://example.com/empty"},
]


def test_company_news_sends_expected_request_and_maps_items():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=NEWS)

    items = client_for(handler).company_news("AAPL", date(2026, 11, 17))
    assert seen["path"] == "/api/v1/company-news"
    assert seen["params"] == {"symbol": "AAPL", "from": "2026-11-10", "to": "2026-11-17", "token": TOKEN}
    assert len(items) == 1  # unsafe URL and empty headline are skipped
    it = items[0]
    assert it.title == "Apple beats estimates" and it.snippet == "Strong & steady quarter."
    assert it.url == "https://example.com/a" and it.origin == "finnhub_company" and it.source == "Reuters"
    assert it.published_at == datetime.fromtimestamp(1763380800, tz=timezone.utc)


def test_market_news_uses_general_category():
    seen = {}

    def handler(request):
        seen["path"], seen["params"] = request.url.path, dict(request.url.params)
        return httpx.Response(200, json=NEWS[:1])

    items = client_for(handler).market_news()
    assert seen["path"] == "/api/v1/news" and seen["params"]["category"] == "general"
    assert items[0].origin == "finnhub_market"


def test_profile_returns_name_and_industry():
    def handler(request):
        assert request.url.path == "/api/v1/stock/profile2"
        return httpx.Response(200, json={"name": "Apple Inc", "finnhubIndustry": "Technology"})

    assert client_for(handler).profile("AAPL") == {"name": "Apple Inc", "industry": "Technology"}


def test_profile_empty_object_gives_nones():
    assert client_for(lambda r: httpx.Response(200, json={})).profile("ZZZZ") == {"name": None, "industry": None}


@pytest.mark.parametrize("response", [
    httpx.Response(401, text="bad key"),
    httpx.Response(429, text="slow down"),
    httpx.Response(500, text="boom"),
    httpx.Response(200, text="<html>not json</html>"),
    httpx.Response(200, json={"unexpected": "object"}),
])
def test_failures_raise_a_safe_news_source_error(response):
    with pytest.raises(NewsSourceError) as exc:
        client_for(lambda r: response).company_news("AAPL", date(2026, 11, 17))
    assert exc.value.source == "finnhub"
    assert TOKEN not in str(exc.value) and "http" not in str(exc.value)


def test_network_errors_do_not_leak_the_token():
    def handler(request):
        raise httpx.ConnectError("failed for " + str(request.url))

    with pytest.raises(NewsSourceError) as exc:
        client_for(handler).market_news()
    assert exc.value.__context__ is None and exc.value.__cause__ is None
    assert TOKEN not in str(exc.value)
    assert "ConnectError for" not in str(exc.value) and "http" not in str(exc.value)


def test_invalid_json_does_not_attach_the_original_error():
    with pytest.raises(NewsSourceError) as exc:
        client_for(lambda r: httpx.Response(200, text="<html>x</html>")).market_news()
    assert exc.value.__context__ is None and exc.value.__cause__ is None


@pytest.mark.parametrize("bad_ts", [1e30, -5, True, 0, "1763380800", float("inf"), float("nan")])
def test_bad_timestamps_give_none_and_keep_other_items(bad_ts):
    payload = [
        {"datetime": bad_ts, "headline": "Odd time", "source": "X", "summary": "", "url": "https://example.com/odd"},
        {"datetime": 1763380800, "headline": "Good time", "source": "X", "summary": "",
         "url": "https://example.com/good"},
    ]
    items = client_for(lambda r: httpx.Response(200, content=json.dumps(payload))).market_news()
    by_title = {i.title: i for i in items}
    assert by_title["Odd time"].published_at is None
    assert by_title["Good time"].published_at == datetime.fromtimestamp(1763380800, tz=timezone.utc)


def test_http_client_loggers_never_print_urls():
    # the token is a query parameter, so request-URL logging must stay off
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    assert logging.getLogger("httpcore").getEffectiveLevel() >= logging.WARNING
