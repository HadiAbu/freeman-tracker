import pytest

from app import main
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


@pytest.mark.parametrize("side", ["upper_limit", "lower_limit"])
@pytest.mark.parametrize("number", ["1e400", "Infinity", "-Infinity", "NaN"])
def test_a_limit_that_is_not_a_finite_number_is_a_clean_422(client, side, number):
    w = watch(client, note="kept")
    headers = {"Content-Type": "application/json"}
    r = client.post(
        "/watchlist", content=f'{{"ticker": "MSFT", "{side}": {number}}}', headers=headers
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"][0]["loc"] == ["body", side]
    r = client.patch(f"/watchlist/{w['id']}", content=f'{{"{side}": {number}}}', headers=headers)
    assert r.status_code == 422, r.text
    listed = client.get("/watchlist")
    assert listed.status_code == 200
    assert [(i["ticker"], i[side]) for i in listed.json()] == [("AAPL", None)]


def test_an_infinite_number_echoed_inside_a_whole_body_is_a_clean_422_too(client):
    # With `ticker` missing, the error echoes the entire body, so the infinity is nested.
    r = client.post(
        "/watchlist", content='{"upper_limit": [1e400]}', headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422, r.text
    assert ["body", "ticker"] in [e["loc"] for e in r.json()["detail"]]


# ---------- the checker commits between a route's read and its write ----------
def checker_triggers_during_the_request(client, monkeypatch, side):
    """The route looks up the latest price after reading the row and before writing it: commit
    'triggered' from a second connection at that moment, as the background check would."""
    real = main._latest_price

    def latest_price_then_checker(*args):
        price = real(*args)
        force_state(client, side, "triggered")
        return price

    monkeypatch.setattr(main, "_latest_price", latest_price_then_checker)


@pytest.mark.parametrize("side,other", [("upper", "lower"), ("lower", "upper")])
def test_saving_again_does_not_overwrite_a_state_the_checker_just_committed(
    client, monkeypatch, side, other
):
    limits = {"upper_limit": 200, "lower_limit": 100}
    watch(client, **limits)
    checker_triggers_during_the_request(client, monkeypatch, side)
    w = watch(client, **{**limits, f"{other}_limit": 150})
    assert w[f"{side}_state"] == "triggered"


@pytest.mark.parametrize("send_unchanged_too", [False, True])
@pytest.mark.parametrize("side,other", [("upper", "lower"), ("lower", "upper")])
def test_patch_does_not_overwrite_a_state_the_checker_just_committed(
    client, monkeypatch, side, other, send_unchanged_too
):
    limits = {"upper_limit": 200, "lower_limit": 100}
    w = watch(client, **limits)
    checker_triggers_during_the_request(client, monkeypatch, side)
    body = {f"{other}_limit": 150}
    if send_unchanged_too:
        body[f"{side}_limit"] = limits[f"{side}_limit"]
    r = client.patch(f"/watchlist/{w['id']}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()[f"{side}_state"] == "triggered"


def test_patch_removing_a_limit_resets_its_state(client):
    put_price(client, "AAPL", 200)
    w = watch(client, upper_limit=150)
    assert w["upper_state"] == "triggered"
    r = client.patch(f"/watchlist/{w['id']}", json={"upper_limit": None})
    assert (r.json()["upper_limit"], r.json()["upper_state"]) == (None, "armed")


# ---------- a same-day manual mark must not hide that the market is already past a limit ----------
def put_market_price(client, price, as_of="2026-11-01", ticker="AAPL"):
    conn = connect(client.db_path)
    conn.execute(
        "INSERT INTO prices (user_id, ticker, price, as_of, source) VALUES (NULL, ?, ?, ?, 'market')",
        (ticker, price, as_of),
    )
    conn.commit()


@pytest.mark.parametrize(
    "side,market,manual",
    [
        ("upper", 160, 140),  # only the market mark is past the limit of 150
        ("upper", 140, 160),  # only the visible (manual) price is past it
        ("lower", 140, 160),
        ("lower", 160, 140),
    ],
)
def test_a_new_limit_starts_triggered_when_the_market_or_the_visible_price_is_past_it(
    client, side, market, manual
):
    put_market_price(client, market)
    put_price(client, "AAPL", manual)  # same day: this one is the visible price
    assert watch(client, **{f"{side}_limit": 150})[f"{side}_state"] == "triggered"


@pytest.mark.parametrize("side,market,manual", [("upper", 160, 140), ("lower", 140, 160)])
def test_a_changed_limit_is_judged_against_the_market_mark_too(client, side, market, manual):
    w = watch(client)
    put_market_price(client, market)
    put_price(client, "AAPL", manual)
    r = client.patch(f"/watchlist/{w['id']}", json={f"{side}_limit": 150})
    assert r.json()[f"{side}_state"] == "triggered"


def test_only_the_newest_market_mark_of_that_ticker_counts(client):
    put_market_price(client, 160, as_of="2026-10-30")  # older day, past the limit
    put_market_price(client, 140, as_of="2026-11-01")  # newest market mark, not past it
    put_market_price(client, 999, as_of="2026-11-02", ticker="MSFT")  # another ticker
    assert watch(client, upper_limit=150)["upper_state"] == "armed"
