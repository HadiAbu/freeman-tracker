"""One user must never see or change another user's data, on any route."""

import pytest

TRADE = {"ticker": "AAPL", "side": "buy", "shares": 10, "price": 100, "traded_at": "2026-01-01"}


@pytest.fixture
def alice(client):
    return client


@pytest.fixture
def bob(client):
    return client.new_user("bob@example.com")


def test_trades_are_private(alice, bob):
    alice.post("/trades", json=TRADE)
    assert bob.get("/trades").json() == []
    assert len(alice.get("/trades").json()) == 1


def test_another_users_trade_id_is_a_404_for_read_patch_and_delete(alice, bob):
    trade_id = alice.post("/trades", json=TRADE).json()["id"]
    assert bob.patch(f"/trades/{trade_id}", json={"shares": 1}).status_code == 404
    assert bob.delete(f"/trades/{trade_id}").status_code == 404
    still = alice.get("/trades").json()
    assert len(still) == 1 and still[0]["shares"] == 10


def test_each_user_can_hold_the_same_ticker_independently(alice, bob):
    alice.post("/trades", json=TRADE)
    # Bob selling AAPL he does not own is an oversell for him, whatever Alice holds.
    r = bob.post("/trades", json={**TRADE, "side": "sell", "shares": 1})
    assert r.status_code == 409
    assert bob.post("/trades", json={**TRADE, "shares": 3}).status_code == 201
    shares = {h["ticker"]: h["shares"] for h in bob.get("/portfolio/summary").json()["holdings"]}
    assert shares == {"AAPL": 3}


def test_watchlist_is_private_and_same_ticker_does_not_collide(alice, bob):
    item = alice.post("/watchlist", json={"ticker": "NVDA", "upper_limit": 500}).json()
    assert bob.get("/watchlist").json() == []
    bob.post("/watchlist", json={"ticker": "NVDA", "upper_limit": 1})  # not an upsert of Alice's row
    assert alice.get("/watchlist").json()[0]["upper_limit"] == 500
    assert bob.patch(f"/watchlist/{item['id']}", json={"note": "hi"}).status_code == 404
    assert bob.delete(f"/watchlist/{item['id']}").status_code == 404
    assert len(alice.get("/watchlist").json()) == 1


def test_manual_prices_are_private(alice, bob):
    alice.post("/prices", json={"ticker": "AAPL", "price": 150, "as_of": "2026-02-01"})
    assert bob.get("/prices").json() == []
    assert bob.get("/prices/AAPL").json() == []
    assert len(alice.get("/prices/AAPL").json()) == 1


def test_a_users_price_does_not_value_another_users_holding(alice, bob):
    for c in (alice, bob):
        c.post("/trades", json=TRADE)
    alice.post("/prices", json={"ticker": "AAPL", "price": 999, "as_of": "2026-02-01"})
    value = lambda c: c.get("/portfolio/summary").json()["holdings"][0]["price"]
    assert value(alice) == 999
    assert value(bob) == 100  # falls back to Bob's own last trade price


def test_market_marks_with_no_owner_are_visible_to_everyone(alice, bob):
    from app.db import connect

    db = connect(alice.db_path)
    db.execute(
        "INSERT INTO prices (user_id, ticker, price, as_of, source) VALUES (NULL, 'AAPL', 123, '2026-03-01', 'market')"
    )
    db.commit()
    for c in (alice, bob):
        assert c.get("/prices").json()[0]["price"] == 123


def test_holding_metadata_is_private(alice, bob):
    alice.put("/holdings/AAPL", json={"sector": "Tech"})
    assert bob.patch("/holdings/AAPL", json={"asset_class": "Stock"}).json()["sector"] is None
    assert alice.patch("/holdings/AAPL", json={"name": "Apple"}).json()["sector"] == "Tech"


def test_portfolio_views_are_private(alice, bob):
    alice.post("/trades", json=TRADE)
    assert bob.get("/portfolio/summary").json()["holdings"] == []
    assert bob.get("/portfolio/allocation?by=ticker").json() == []
    assert bob.get("/portfolio/history").json() == []
    assert len(alice.get("/portfolio/allocation?by=ticker").json()) == 1


def test_a_deleted_trade_only_ever_affects_its_owner(alice, bob):
    a_id = alice.post("/trades", json=TRADE).json()["id"]
    bob.post("/trades", json=TRADE)
    assert alice.delete(f"/trades/{a_id}").status_code == 204
    assert len(bob.get("/trades").json()) == 1
