from datetime import datetime, timezone

import httpx
import pytest

from app.news import gdelt
from app.news.gdelt import GdeltClient, parse_seendate
from app.news.models import NewsSourceError

SAMPLE = {"articles": [
    {"url": "https://news.example.com/a?utm_source=z", "title": "Oil jumps on supply fears",
     "seendate": "20261117T093000Z", "domain": "news.example.com", "language": "English"},
    {"url": "https://news.example.com/b", "title": "No date here", "domain": "news.example.com"},
    {"url": "javascript:alert(1)", "title": "bad"},
    {"url": "https://news.example.com/c"},  # no title
]}


class FakeTime:
    def __init__(self):
        self.t = 1000.0
        self.slept = []

    def clock(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


@pytest.fixture(autouse=True)
def fresh_throttle():
    gdelt.reset_throttle()
    yield
    gdelt.reset_throttle()


def client_for(handler, ft=None):
    ft = ft or FakeTime()
    return GdeltClient(transport=httpx.MockTransport(handler), clock=ft.clock, sleep=ft.sleep), ft


def test_articles_sends_expected_params_and_maps_items():
    seen = {}

    def handler(request):
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=SAMPLE)

    c, _ = client_for(handler)
    items = c.articles('"Apple Inc" sourcelang:english')
    assert seen["params"] == {
        "query": '"Apple Inc" sourcelang:english', "mode": "artlist", "format": "json",
        "maxrecords": "12", "timespan": "3d", "sort": "datedesc",
    }
    assert [i.title for i in items] == ["Oil jumps on supply fears", "No date here"]
    a, b = items
    assert a.url == "https://news.example.com/a" and a.source == "news.example.com" and a.origin == "gdelt"
    assert a.published_at == datetime(2026, 11, 17, 9, 30, tzinfo=timezone.utc) and a.snippet == ""
    assert b.published_at is None  # tolerated: missing seendate


def test_parse_seendate_formats():
    assert parse_seendate("20261117T093000Z") == datetime(2026, 11, 17, 9, 30, tzinfo=timezone.utc)
    assert parse_seendate("2026-11-17T09:30:00Z") == datetime(2026, 11, 17, 9, 30, tzinfo=timezone.utc)
    assert parse_seendate("garbage") is None and parse_seendate(None) is None
    assert parse_seendate(12345) is None and parse_seendate(["x"]) is None


def test_plain_text_429_is_a_rate_limit_error_not_a_crash():
    c, _ = client_for(lambda r: httpx.Response(429, text="Please limit requests to one every 5 seconds"))
    with pytest.raises(NewsSourceError) as exc:
        c.articles("x")
    assert exc.value.source == "gdelt" and "rate" in exc.value.reason


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="not json at all"),
    httpx.Response(200, json=["list", "not", "object"]),
    httpx.Response(500, text="boom"),
])
def test_unexpected_responses_raise(response):
    c, _ = client_for(lambda r: response)
    with pytest.raises(NewsSourceError):
        c.articles("x")


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="not json SECRET-BODY"),
    httpx.Response(200, json=["list", "not", "object"]),
    httpx.Response(200, json={"articles": "nope"}),
])
def test_parse_failures_carry_no_context(response):
    c, _ = client_for(lambda r: response)
    with pytest.raises(NewsSourceError) as exc:
        c.articles("x")
    assert exc.value.__context__ is None and exc.value.__cause__ is None
    assert exc.value.reason == "unexpected response"


def test_missing_articles_key_means_no_results():
    c, _ = client_for(lambda r: httpx.Response(200, json={}))
    assert c.articles("x") == []


def test_calls_are_spaced_at_least_five_seconds_apart():
    c, ft = client_for(lambda r: httpx.Response(200, json={"articles": []}))
    c.articles("a")
    assert ft.slept == []  # the first call never waits
    ft.t += 1.5
    c.articles("b")
    assert ft.slept == [pytest.approx(3.5)]  # waited out the rest of the 5 s window
    ft.t += 10
    c.articles("c")
    assert len(ft.slept) == 1  # long enough since the last call: no wait


def test_network_error_is_a_news_source_error_without_context():
    def handler(request):
        raise httpx.ConnectError("down http://secret.example/?token=abc")

    c, _ = client_for(handler)
    with pytest.raises(NewsSourceError) as exc:
        c.articles("x")
    assert exc.value.reason == "ConnectError"
    assert exc.value.__context__ is None and exc.value.__cause__ is None
    assert "secret" not in str(exc.value)


def test_non_http_error_httpx_failures_are_wrapped():
    def handler(request):
        raise httpx.InvalidURL("bad url with secret")

    c, _ = client_for(handler)
    with pytest.raises(NewsSourceError) as exc:
        c.articles("x")
    assert exc.value.source == "gdelt" and exc.value.reason == "InvalidURL"
    assert exc.value.__context__ is None and exc.value.__cause__ is None


def test_odd_article_fields_never_raise_and_other_articles_still_map():
    data = {"articles": [
        {"url": "https://n.example.com/1", "title": 42, "seendate": "20261117T093000Z"},
        {"url": None, "title": "null url"},
        {"url": "https://n.example.com/2", "title": "odd date", "seendate": 12345, "domain": 7},
        {"url": 5, "title": "numeric url"},
        "not a dict",
        {"url": "https://n.example.com/3", "title": "good", "domain": "n.example.com"},
    ]}
    c, _ = client_for(lambda r: httpx.Response(200, json=data))
    items = c.articles("x")
    assert [i.title for i in items] == ["odd date", "good"]
    assert items[0].published_at is None and items[0].source == "n.example.com"
