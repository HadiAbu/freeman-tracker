def buy(client, ticker="AAPL", shares=10, price=100, day="2026-01-01", **kw):
    return client.post(
        "/trades",
        json={"ticker": ticker, "side": "buy", "shares": shares, "price": price, "traded_at": day, **kw},
    )


def sell(client, ticker="AAPL", shares=5, price=120, day="2026-01-02"):
    return client.post(
        "/trades",
        json={"ticker": ticker, "side": "sell", "shares": shares, "price": price, "traded_at": day},
    )


# ---------- auth ----------
def test_health_is_public(anon):
    assert anon.get("/health").status_code == 200


def test_missing_or_bad_token_is_401(anon):
    assert anon.get("/trades").status_code == 401
    assert anon.get("/trades", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert anon.get("/trades", headers={"Authorization": "Basic abc"}).status_code == 401


def test_unconfigured_server_fails_closed(client):
    from app import main
    from app.config import Settings, get_settings

    main.app.dependency_overrides[get_settings] = lambda: Settings(jwt_secret="", _env_file=None)
    assert client.get("/trades").status_code == 503


# ---------- trades ----------
def test_create_list_filter_trades(client):
    r = buy(client, ticker="aapl")
    assert r.status_code == 201 and r.json()["ticker"] == "AAPL"
    buy(client, ticker="MSFT")
    sell(client)
    assert len(client.get("/trades").json()) == 3
    assert [t["ticker"] for t in client.get("/trades?ticker=msft").json()] == ["MSFT"]
    assert all(t["side"] == "sell" for t in client.get("/trades?side=sell").json())


def test_validation_rejects_bad_input(client):
    assert buy(client, shares=0).status_code == 422
    assert buy(client, price=-1).status_code == 422
    assert client.post("/trades", json={"ticker": "X"}).status_code == 422


def test_oversell_rejected_with_409(client):
    buy(client, shares=5)
    r = sell(client, shares=6)
    assert r.status_code == 409
    assert len(client.get("/trades").json()) == 1  # nothing written


def test_patch_that_causes_oversell_is_409_and_unchanged(client):
    buy(client, shares=10)
    sid = sell(client, shares=8).json()["id"]
    bid = client.get("/trades?side=buy").json()[0]["id"]
    assert client.patch(f"/trades/{bid}", json={"shares": 5}).status_code == 409
    assert client.get("/trades?side=buy").json()[0]["shares"] == 10
    assert client.patch(f"/trades/{sid}", json={"shares": 3}).json()["shares"] == 3


def test_delete_buy_that_a_sell_depends_on_is_409(client):
    bid = buy(client, shares=10).json()["id"]
    sell(client, shares=4)
    assert client.delete(f"/trades/{bid}").status_code == 409
    assert client.delete("/trades/9999").status_code == 404


def test_delete_trade(client):
    tid = buy(client).json()["id"]
    assert client.delete(f"/trades/{tid}").status_code == 204
    assert client.get("/trades").json() == []


# ---------- watchlist ----------
def test_watchlist_crud_and_pct_to_target(client):
    w = client.post("/watchlist", json={"ticker": "nvda", "target_price": 150}).json()
    assert w["ticker"] == "NVDA"
    client.post("/prices", json={"ticker": "NVDA", "price": 100, "as_of": "2026-01-01"})
    item = client.get("/watchlist").json()[0]
    assert item["price"] == 100 and item["pct_to_target"] == 50
    # re-adding the same ticker upserts instead of duplicating
    client.post("/watchlist", json={"ticker": "NVDA", "target_price": 200})
    items = client.get("/watchlist").json()
    assert len(items) == 1 and items[0]["target_price"] == 200
    assert client.patch(f"/watchlist/{w['id']}", json={"note": "wait"}).json()["note"] == "wait"
    assert client.delete(f"/watchlist/{w['id']}").status_code == 204
    assert client.get("/watchlist").json() == []


# ---------- prices ----------
def test_latest_price_per_ticker(client):
    client.post("/prices", json={"ticker": "AAPL", "price": 100, "as_of": "2026-01-01"})
    client.post("/prices", json={"ticker": "AAPL", "price": 130, "as_of": "2026-01-05"})
    client.post("/prices", json={"ticker": "AAPL", "price": 110, "as_of": "2026-01-03"})
    latest = client.get("/prices").json()
    assert len(latest) == 1 and latest[0]["price"] == 130  # newest as_of wins
    assert len(client.get("/prices/aapl").json()) == 3


# ---------- portfolio ----------
def test_summary_allocation_and_history_end_to_end(client):
    buy(client, "AAPL", 10, 100, "2026-01-01")
    buy(client, "MSFT", 10, 100, "2026-01-01")
    sell(client, "AAPL", 5, 120, "2026-01-02")
    client.put("/holdings/AAPL", json={"sector": "Tech", "asset_class": "Stock"})
    client.put("/holdings/MSFT", json={"sector": "Tech", "asset_class": "Stock"})
    client.post("/prices", json={"ticker": "AAPL", "price": 150, "as_of": "2026-01-03"})

    s = client.get("/portfolio/summary").json()
    by = {h["ticker"]: h for h in s["holdings"]}
    assert by["AAPL"]["shares"] == 5 and by["AAPL"]["market_value"] == 750
    assert by["MSFT"]["price_source"] == "trade"
    assert s["realized_pnl"] == 100  # 5 * (120 - 100)
    assert s["total_value"] == 750 + 1000

    alloc = client.get("/portfolio/allocation?by=sector").json()
    assert alloc[0]["label"] == "Tech" and round(alloc[0]["percent"]) == 100
    assert len(client.get("/portfolio/allocation?by=ticker").json()) == 2
    assert client.get("/portfolio/allocation?by=bogus").status_code == 422

    hist = client.get("/portfolio/history").json()
    assert [h["date"] for h in hist] == ["2026-01-01", "2026-01-02", "2026-01-03"]
    assert hist[-1]["value"] == 1750


def test_empty_portfolio(client):
    s = client.get("/portfolio/summary").json()
    assert s["total_value"] == 0 and s["holdings"] == []
    assert client.get("/portfolio/allocation").json() == []
    assert client.get("/portfolio/history").json() == []


# ---------- regression: review findings ----------
def test_non_ascii_token_is_401_not_500(anon):
    # httpx refuses a non-ASCII str header, so send raw bytes as a hostile client could.
    r = anon.get("/trades", headers={"Authorization": b"Bearer caf\xe9"})
    assert r.status_code == 401


def test_trades_pagination_with_offset(client):
    for i in range(5):
        buy(client, shares=1, day=f"2026-01-0{i + 1}")
    page1 = client.get("/trades?limit=2&offset=0").json()
    page2 = client.get("/trades?limit=2&offset=2").json()
    page3 = client.get("/trades?limit=2&offset=4").json()
    days = [t["traded_at"] for t in page1 + page2 + page3]
    assert days == ["2026-01-05", "2026-01-04", "2026-01-03", "2026-01-02", "2026-01-01"]
    assert len(page3) == 1  # a short page is the last one
    assert client.get("/trades?offset=-1").status_code == 422


def test_inconsistent_ledger_is_a_clear_409_on_reads(client):
    from app.db import connect

    buy(client, shares=5)
    # Corrupt the ledger directly (bypassing the API's oversell check)
    db = connect(client.db_path)
    db.execute(
        "INSERT INTO trades (user_id, ticker, side, shares, price, fee, traded_at)"
        " VALUES (1, 'AAPL', 'sell', 50, 1, 0, '2026-02-01')"
    )
    db.commit()
    for path in ("/portfolio/summary", "/portfolio/allocation", "/portfolio/history"):
        r = client.get(path)
        assert r.status_code == 409, path
        assert "inconsistent" in r.json()["detail"]


def test_allocation_includes_stable_slots(client):
    buy(client, "AAPL", 1, 10, "2026-01-01")
    buy(client, "XOM", 1, 10, "2026-01-02")
    buy(client, "MSFT", 1, 10, "2026-01-03")
    client.put("/holdings/AAPL", json={"sector": "Tech"})
    client.put("/holdings/MSFT", json={"sector": "Tech"})
    client.put("/holdings/XOM", json={"sector": "Energy"})
    sell(client, "AAPL", 1, 10, "2026-01-04")  # AAPL fully closed

    sectors = {s["label"]: s["slot"] for s in client.get("/portfolio/allocation?by=sector").json()}
    assert sectors == {"Tech": 0, "Energy": 1}
    tickers = {s["label"]: s["slot"] for s in client.get("/portfolio/allocation?by=ticker").json()}
    assert tickers == {"XOM": 1, "MSFT": 2}


def test_history_has_no_zero_points_for_watchlist_only_marks(client):
    client.post("/prices", json={"ticker": "WATCHED", "price": 50, "as_of": "2026-01-02"})
    buy(client, "AAPL", 10, 100, "2026-01-10")
    hist = client.get("/portfolio/history").json()
    assert [h["date"] for h in hist] == ["2026-01-10"]


def test_newest_price_mark_wins_regardless_of_insert_order(client):
    buy(client, "AAPL", 10, 100, "2026-01-01")
    client.post("/prices", json={"ticker": "AAPL", "price": 150, "as_of": "2026-03-01"})
    client.post("/prices", json={"ticker": "AAPL", "price": 120, "as_of": "2026-02-01"})  # older, later row
    h = client.get("/portfolio/summary").json()["holdings"][0]
    assert h["price"] == 150 and h["price_source"] == "price"
