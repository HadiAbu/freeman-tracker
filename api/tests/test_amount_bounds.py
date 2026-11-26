"""Numbers that are too big, infinite, or would overflow are refused, and never break a read."""

import json

import pytest

TRADE = {"ticker": "AAPL", "side": "buy", "shares": 1, "price": 1, "fee": 0, "traded_at": "2026-11-01"}
PRICE = {"ticker": "AAPL", "price": 1, "as_of": "2026-11-01"}


def post_raw(client, path, body, field, literal):
    """Send `literal` as written: 1e400 and NaN cannot be produced by a normal JSON encoder."""
    text = json.dumps({**body, field: "@@"}).replace('"@@"', literal)
    return client.post(path, content=text, headers={"Content-Type": "application/json"})


@pytest.mark.parametrize("literal", ["1e400", "NaN", "1e308", "1000000000001"])
@pytest.mark.parametrize(
    "path,body,field",
    [
        ("/trades", TRADE, "shares"),
        ("/trades", TRADE, "price"),
        ("/trades", TRADE, "fee"),
        ("/prices", PRICE, "price"),
        ("/watchlist", {"ticker": "AAPL"}, "upper_limit"),
        ("/watchlist", {"ticker": "AAPL"}, "lower_limit"),
    ],
)
def test_an_absurd_number_is_refused(client, path, body, field, literal):
    assert post_raw(client, path, body, field, literal).status_code == 422


@pytest.mark.parametrize("field", ["shares", "price", "fee"])
def test_a_trade_cannot_be_patched_to_an_absurd_number(client, field):
    made = client.post("/trades", json=TRADE).json()
    r = client.patch(f"/trades/{made['id']}", json={field: 1e308})
    assert r.status_code == 422


@pytest.mark.parametrize("field", ["upper_limit", "lower_limit"])
def test_a_watch_item_cannot_be_patched_to_an_absurd_limit(client, field):
    made = client.post("/watchlist", json={"ticker": "AAPL"}).json()
    assert client.patch(f"/watchlist/{made['id']}", json={field: 1e308}).status_code == 422


def test_the_maximum_itself_is_accepted(client):
    r = client.post("/watchlist", json={"ticker": "AAPL", "upper_limit": 1e12})
    assert r.status_code == 201


def test_a_tiny_price_cannot_break_the_watchlist(client):
    assert client.post("/prices", json={**PRICE, "price": 5e-324}).status_code == 201
    client.post("/watchlist", json={"ticker": "AAPL", "upper_limit": 1e12})
    r = client.get("/watchlist")
    assert r.status_code == 200
    assert r.json()[0]["pct_to_target"] is None
