import pytest

from app.db import connect


def put_price(client, ticker, price, as_of="2026-11-01"):
    r = client.post("/prices", json={"ticker": ticker, "price": price, "as_of": as_of})
    assert r.status_code == 201, r.text


def watch(client, **body):
    r = client.post("/watchlist", json={"ticker": "AAPL", **body})
    assert r.status_code == 201, r.text
    return r.json()


def force_state(client, side, state):
    conn = connect(client.db_path)
    conn.execute(f"UPDATE watchlist SET {side}_state = ? WHERE ticker = 'AAPL'", (state,))
    conn.commit()


def test_both_limits_are_stored_and_start_armed_without_a_price(client):
    w = watch(client, upper_limit=200, lower_limit=150)
    assert (w["upper_limit"], w["lower_limit"]) == (200, 150)
    assert (w["upper_state"], w["lower_state"]) == ("armed", "armed")


def test_the_limits_are_optional(client):
    w = watch(client)
    assert w["upper_limit"] is None and w["lower_limit"] is None


@pytest.mark.parametrize("body", [{"upper_limit": 0}, {"lower_limit": -5}, {"upper_limit": -1}])
def test_limits_must_be_positive(client, body):
    assert client.post("/watchlist", json={"ticker": "AAPL", **body}).status_code == 422


@pytest.mark.parametrize("upper,lower", [(100, 100), (100, 120)])
def test_the_lower_limit_must_be_below_the_upper_limit(client, upper, lower):
    r = client.post("/watchlist", json={"ticker": "AAPL", "upper_limit": upper, "lower_limit": lower})
    assert r.status_code == 422
    assert "lower limit must be below" in r.json()["detail"].lower()


def test_a_limit_the_price_is_already_past_starts_triggered(client):
    put_price(client, "AAPL", 200)
    w = watch(client, upper_limit=150, lower_limit=100)  # 200 is above 150 and above 100
    assert w["upper_state"] == "triggered"
    assert w["lower_state"] == "armed"
    w = watch(client, upper_limit=250, lower_limit=210)  # 200 is below 210
    assert (w["upper_state"], w["lower_state"]) == ("armed", "triggered")


def test_saving_again_keeps_the_state_of_a_limit_that_did_not_change(client):
    put_price(client, "AAPL", 100)
    watch(client, upper_limit=150)
    force_state(client, "upper", "triggered")
    w = watch(client, upper_limit=150, note="same limit, new note")
    assert w["upper_state"] == "triggered"
    w = watch(client, upper_limit=160)  # a changed limit is evaluated again against the price
    assert w["upper_state"] == "armed"


def test_removing_a_limit_resets_its_state(client):
    put_price(client, "AAPL", 200)
    watch(client, upper_limit=150)
    w = watch(client)
    assert w["upper_limit"] is None and w["upper_state"] == "armed"


def test_patch_changes_one_limit_and_checks_it_against_the_stored_other(client):
    w = watch(client, upper_limit=100)
    r = client.patch(f"/watchlist/{w['id']}", json={"lower_limit": 120})
    assert r.status_code == 422
    r = client.patch(f"/watchlist/{w['id']}", json={"lower_limit": 80})
    assert r.status_code == 200
    assert (r.json()["upper_limit"], r.json()["lower_limit"]) == (100, 80)


def test_the_list_reports_the_distance_to_the_upper_limit(client):
    put_price(client, "AAPL", 100)
    watch(client, upper_limit=110)
    item = client.get("/watchlist").json()[0]
    assert item["pct_to_target"] == pytest.approx(10.0)
    assert item["upper_state"] == "armed"
