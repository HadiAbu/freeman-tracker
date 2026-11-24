def test_patch_updates_only_sent_fields(client):
    client.put("/holdings/AAPL", json={"name": "Apple", "sector": "Tech", "asset_class": "Stock"})
    r = client.patch("/holdings/aapl", json={"asset_class": "ETF"})
    assert r.status_code == 200
    row = r.json()
    assert row["ticker"] == "AAPL"
    assert (row["name"], row["sector"], row["asset_class"]) == ("Apple", "Tech", "ETF")


def test_patch_creates_missing_row(client):
    r = client.patch("/holdings/NVDA", json={"sector": "Technology"})
    assert r.status_code == 200
    row = r.json()
    assert (row["name"], row["sector"], row["asset_class"]) == (None, "Technology", None)


def test_patch_explicit_null_clears_field(client):
    client.put("/holdings/AAPL", json={"name": "Apple", "sector": "Tech"})
    row = client.patch("/holdings/AAPL", json={"sector": None}).json()
    assert (row["name"], row["sector"]) == ("Apple", None)


def test_patch_ignores_unknown_fields_like_put(client):
    client.put("/holdings/AAPL", json={"name": "Apple"})
    r = client.patch("/holdings/AAPL", json={"sector": "Tech", "ticker": "EVIL", "id": 99})
    assert r.status_code == 200
    row = r.json()
    assert row["ticker"] == "AAPL" and row["sector"] == "Tech" and row["name"] == "Apple"


def test_patch_only_unknown_fields_is_422(client):
    assert client.patch("/holdings/AAPL", json={"bogus": 1}).status_code == 422


def test_patch_empty_body_is_422_and_creates_nothing(client):
    assert client.patch("/holdings/AAPL", json={}).status_code == 422
    # no row was created: a later PATCH-created row starts with no name
    row = client.patch("/holdings/AAPL", json={"sector": "Tech"}).json()
    assert row["name"] is None


def test_patch_requires_auth(client):
    r = client.patch("/holdings/AAPL", json={"sector": "Tech"}, headers={"X-API-Key": ""})
    assert r.status_code == 401
    r = client.patch("/holdings/AAPL", json={"sector": "Tech"}, headers={"X-API-Key": "nope"})
    assert r.status_code == 401
