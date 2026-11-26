from datetime import date, datetime, timezone

import httpx
import pytest

from app import main, market_routes
from app.db import connect
from app.quotes import FinnhubQuotes, Quote, QuoteCache, QuoteError

BUY = {"ticker": "AAPL", "side": "buy", "shares": 10, "price": 100, "traded_at": "2026-01-01"}
TODAY = datetime.now(timezone.utc).date()


class FakeProvider:
    """No network: answers from a dict, counts calls, and fails for tickers listed in `broken`."""

    def __init__(self, prices=None, broken=()):
        self.prices = prices or {}
        self.broken = set(broken)
        self.calls: list[str] = []

    def quote(self, ticker: str) -> Quote:
        self.calls.append(ticker)
        if ticker in self.broken or ticker not in self.prices:
            raise QuoteError("no quote for this symbol")
        return Quote(ticker, self.prices[ticker], TODAY)


@pytest.fixture
def provider(client):
    fake = FakeProvider({"AAPL": 190.5, "MSFT": 410.0, "NVDA": 900.0})
    main.app.dependency_overrides[market_routes.get_quote_provider] = lambda: fake
    cache = QuoteCache(ttl=60)  # one instance, as in production, so entries survive between requests
    main.app.dependency_overrides[market_routes.get_quote_cache] = lambda: cache
    yield fake
    market_routes.reset_quote_cache()


def refresh(c):
    return c.post("/prices/refresh")


# ---------- refresh ----------
def test_refresh_fetches_held_and_watched_tickers_and_values_the_portfolio(client, provider):
    client.post("/trades", json=BUY)
    client.post("/watchlist", json={"ticker": "MSFT"})
    body = refresh(client).json()
    assert {u["ticker"] for u in body["updated"]} == {"AAPL", "MSFT"}
    assert body["failed"] == []
    holding = client.get("/portfolio/summary").json()["holdings"][0]
    assert holding["price"] == 190.5 and holding["price_kind"] == "market"
    assert holding["price_as_of"] == TODAY.isoformat()
    watch = client.get("/watchlist").json()[0]
    assert watch["price"] == 410.0 and watch["price_kind"] == "market"


def test_closed_positions_are_not_refreshed(client, provider):
    client.post("/trades", json=BUY)
    client.post("/trades", json={**BUY, "side": "sell", "traded_at": "2026-02-01"})
    refresh(client)
    assert provider.calls == []


def test_a_provider_failure_for_one_ticker_does_not_fail_the_rest(client, provider):
    client.post("/trades", json=BUY)
    client.post("/watchlist", json={"ticker": "ZZZZ"})
    r = refresh(client)
    assert r.status_code == 200
    body = r.json()
    assert [u["ticker"] for u in body["updated"]] == ["AAPL"]
    assert body["failed"] == [{"ticker": "ZZZZ", "reason": "no quote for this symbol"}]


def test_a_total_outage_keeps_last_known_prices_and_is_not_an_error(client, provider):
    client.post("/trades", json=BUY)
    client.post("/prices", json={"ticker": "AAPL", "price": 120, "as_of": "2026-01-15"})
    provider.broken = {"AAPL"}
    r = refresh(client)
    assert r.status_code == 200 and r.json()["updated"] == []
    holding = client.get("/portfolio/summary").json()["holdings"][0]
    assert holding["price"] == 120 and holding["price_kind"] == "manual"


def test_the_cache_stops_repeat_refreshes_from_hitting_the_provider(client, provider):
    client.post("/trades", json=BUY)
    refresh(client)
    second = refresh(client).json()
    assert provider.calls == ["AAPL"]
    assert second["from_cache"] == 1 and second["updated"][0]["price"] == 190.5


def test_refreshing_twice_in_a_day_updates_one_row_not_two(client, provider):
    client.post("/trades", json=BUY)
    refresh(client)
    no_cache = QuoteCache(ttl=0)
    main.app.dependency_overrides[market_routes.get_quote_cache] = lambda: no_cache
    provider.prices["AAPL"] = 195.0
    refresh(client)
    history = client.get("/prices/AAPL").json()
    assert [(p["price"], p["source"]) for p in history] == [(195.0, "market")]


def test_two_users_share_market_marks_but_only_refresh_their_own_tickers(client, provider):
    bob = client.new_user("bob@example.com")
    client.post("/trades", json=BUY)
    bob.post("/watchlist", json={"ticker": "NVDA"})
    refresh(client)
    assert provider.calls == ["AAPL"]
    refresh(bob)
    assert provider.calls == ["AAPL", "NVDA"]
    # a market mark is visible to everyone, a manual one only to its owner
    assert {p["ticker"] for p in bob.get("/prices").json()} == {"AAPL", "NVDA"}


def test_refresh_requires_sign_in(anon, provider):
    assert anon.post("/prices/refresh").status_code == 401


def test_without_a_finnhub_key_refresh_is_503_naming_the_setting(client):
    main.app.dependency_overrides.pop(market_routes.get_quote_provider, None)
    r = refresh(client)
    assert r.status_code == 503 and "FINNHUB_API_KEY" in r.json()["detail"]


def test_an_inconsistent_ledger_does_not_block_a_refresh(client, provider):
    client.post("/trades", json=BUY)
    db = connect(client.db_path)
    db.execute(
        "INSERT INTO trades (user_id, ticker, side, shares, price, fee, traded_at) VALUES (1, 'AAPL', 'sell', 50, 1, 0, '2026-02-01')"
    )
    db.commit()
    assert refresh(client).status_code == 200


# ---------- manual vs market ----------
def test_a_manual_mark_beats_a_market_mark_on_the_same_day(client, provider):
    client.post("/trades", json=BUY)
    refresh(client)  # market 190.5 today
    client.post("/prices", json={"ticker": "AAPL", "price": 150, "as_of": TODAY.isoformat()})
    holding = client.get("/portfolio/summary").json()["holdings"][0]
    assert holding["price"] == 150 and holding["price_kind"] == "manual"


def test_a_newer_market_mark_beats_an_older_manual_one(client, provider):
    client.post("/trades", json=BUY)
    client.post("/prices", json={"ticker": "AAPL", "price": 150, "as_of": "2026-01-01"})
    refresh(client)
    assert client.get("/portfolio/summary").json()["holdings"][0]["price"] == 190.5


def test_a_trade_fallback_is_labelled(client, provider):
    client.post("/trades", json=BUY)
    holding = client.get("/portfolio/summary").json()["holdings"][0]
    assert holding["price_kind"] == "trade" and holding["price_as_of"] is None


# ---------- the Finnhub client, against a fake transport ----------
def finnhub(handler):
    return FinnhubQuotes("secret-key", transport=httpx.MockTransport(handler))


def test_finnhub_quote_parses_price_and_trade_day():
    ts = int(datetime(2026, 3, 6, 21, 0, tzinfo=timezone.utc).timestamp())

    def handler(request):
        assert request.url.params["symbol"] == "AAPL"
        return httpx.Response(200, json={"c": 190.5, "pc": 188.0, "t": ts})

    q = finnhub(handler).quote("AAPL")
    assert q.price == 190.5 and q.as_of == date(2026, 3, 6)


@pytest.mark.parametrize("payload", [{"c": 0, "t": 0}, {"c": None}, {}, [], {"c": "190"}, "nan"])
def test_finnhub_rejects_unknown_or_malformed_quotes(payload):
    # "nan" stands for a bare NaN in the body, which Python's JSON reader accepts but httpx cannot encode
    content = b'{"c": NaN}' if payload == "nan" else None
    response = httpx.Response(200, content=content) if content else httpx.Response(200, json=payload)
    with pytest.raises(QuoteError):
        finnhub(lambda r: response).quote("ZZZZ")


def test_finnhub_future_timestamp_is_clamped_to_today():
    ts = int(datetime(2099, 1, 1, tzinfo=timezone.utc).timestamp())
    q = finnhub(lambda r: httpx.Response(200, json={"c": 10, "t": ts})).quote("AAPL")
    assert q.as_of <= datetime.now(timezone.utc).date()


@pytest.mark.parametrize("status,words", [(429, "rate limit"), (500, "HTTP 500"), (401, "HTTP 401")])
def test_finnhub_http_errors_become_safe_messages(status, words):
    with pytest.raises(QuoteError, match=words):
        finnhub(lambda r: httpx.Response(status)).quote("AAPL")


def test_a_network_error_message_never_contains_the_key_or_the_url():
    def boom(request):
        raise httpx.ConnectError("could not connect to https://finnhub.io/api/v1/quote?token=secret-key")

    with pytest.raises(QuoteError) as e:
        finnhub(boom).quote("AAPL")
    assert "secret-key" not in str(e.value) and "finnhub.io" not in str(e.value)
    assert e.value.__context__ is None  # the original error text never travels with it


def test_unreadable_json_is_a_quote_error():
    with pytest.raises(QuoteError):
        finnhub(lambda r: httpx.Response(200, content=b"<html>")).quote("AAPL")


# ---------- cache ----------
def test_cache_expires_after_its_ttl():
    now = [0.0]
    cache = QuoteCache(ttl=10, clock=lambda: now[0])
    q = Quote("AAPL", 1.0, TODAY)
    cache.put(q)
    assert cache.get("AAPL") == q
    now[0] = 11
    assert cache.get("AAPL") is None
