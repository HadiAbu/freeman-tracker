from app import ledger


def seed(client):
    client.post("/trades", json={"ticker": "AAPL", "side": "buy", "shares": 10, "price": 100, "traded_at": "2026-01-01"})
    client.put("/holdings/AAPL", json={"name": "Apple Inc."})
    client.post("/watchlist", json={"ticker": "NVDA", "name": "NVIDIA"})


def test_holding_for_returns_the_open_position(client):
    from app.db import connect

    seed(client)
    h = ledger.holding_for(connect(client.db_path), 1, "AAPL")
    assert h is not None and h.shares == 10 and h.name == "Apple Inc."


def test_holding_for_is_none_when_not_held(client):
    from app.db import connect

    seed(client)
    assert ledger.holding_for(connect(client.db_path), 1, "NVDA") is None


def test_watchlist_name(client):
    from app.db import connect

    seed(client)
    conn = connect(client.db_path)
    assert ledger.watchlist_name(conn, 1, "NVDA") == "NVIDIA"
    assert ledger.watchlist_name(conn, 1, "MSFT") is None
