from datetime import date

import pytest

from app.portfolio import (
    OversellError,
    Trade,
    allocation,
    build_summary,
    compute_positions,
    value_history,
)


def T(id, side, shares, price, day, ticker="AAPL", fee=0.0):
    return Trade(id, ticker, side, shares, price, fee, date(2026, 1, day))


def test_average_cost_across_two_buys():
    pos = compute_positions([T(1, "buy", 10, 100, 1), T(2, "buy", 10, 200, 2)])["AAPL"]
    assert pos.shares == 20
    assert pos.avg_cost == pytest.approx(150)
    assert pos.realized_pnl == 0


def test_fees_are_added_to_cost_basis():
    pos = compute_positions([T(1, "buy", 10, 100, 1, fee=10)])["AAPL"]
    assert pos.cost_basis == pytest.approx(1010)
    assert pos.avg_cost == pytest.approx(101)


def test_partial_sell_realizes_pnl_and_keeps_avg_cost():
    pos = compute_positions(
        [T(1, "buy", 10, 100, 1), T(2, "buy", 10, 200, 2), T(3, "sell", 5, 180, 3)]
    )["AAPL"]
    assert pos.shares == 15
    assert pos.avg_cost == pytest.approx(150)  # unchanged by a sell
    assert pos.realized_pnl == pytest.approx(5 * (180 - 150))


def test_sell_fee_reduces_realized_pnl():
    pos = compute_positions([T(1, "buy", 10, 100, 1), T(2, "sell", 10, 110, 2, fee=5)])["AAPL"]
    assert pos.realized_pnl == pytest.approx(100 - 5)


def test_full_close_zeroes_position_but_keeps_realized():
    pos = compute_positions([T(1, "buy", 10, 100, 1), T(2, "sell", 10, 120, 2)])["AAPL"]
    assert pos.shares == 0 and pos.cost_basis == 0
    assert pos.realized_pnl == pytest.approx(200)


def test_oversell_raises():
    with pytest.raises(OversellError):
        compute_positions([T(1, "buy", 5, 100, 1), T(2, "sell", 6, 100, 2)])


def test_trades_processed_by_date_not_insert_order():
    # sell has the lower id but a later date than the buy -> still valid
    trades = [T(2, "buy", 10, 100, 1), T(1, "sell", 4, 110, 2)]
    assert compute_positions(trades)["AAPL"].shares == 6


def test_sell_before_buy_by_date_is_oversell():
    with pytest.raises(OversellError):
        compute_positions([T(1, "buy", 10, 100, 5), T(2, "sell", 4, 110, 2)])


def test_summary_uses_manual_price_else_last_trade():
    positions = compute_positions(
        [T(1, "buy", 10, 100, 1), T(2, "buy", 5, 50, 1, ticker="VTI")]
    )
    s = build_summary(positions, {"AAPL": 120})
    by = {h.ticker: h for h in s.holdings}
    assert by["AAPL"].price_source == "price" and by["AAPL"].market_value == 1200
    assert by["VTI"].price_source == "trade" and by["VTI"].market_value == 250
    assert s.total_value == pytest.approx(1450)
    assert s.unrealized_pnl == pytest.approx(200)
    assert by["AAPL"].unrealized_pct == pytest.approx(20)


def test_closed_positions_excluded_from_holdings():
    positions = compute_positions([T(1, "buy", 1, 10, 1), T(2, "sell", 1, 12, 2)])
    s = build_summary(positions, {})
    assert s.holdings == [] and s.realized_pnl == pytest.approx(2)


def test_allocation_by_ticker_and_sector_with_unassigned():
    positions = compute_positions(
        [
            T(1, "buy", 10, 100, 1),
            T(2, "buy", 10, 100, 1, ticker="MSFT"),
            T(3, "buy", 10, 200, 1, ticker="XOM"),
        ]
    )
    meta = {"AAPL": {"sector": "Tech"}, "MSFT": {"sector": "Tech"}}
    s = build_summary(positions, {}, meta)
    by_ticker = allocation(s, "ticker")
    assert [x["label"] for x in by_ticker][0] in {"XOM", "AAPL", "MSFT"}
    assert sum(x["percent"] for x in by_ticker) == pytest.approx(100)
    by_sector = {x["label"]: x["value"] for x in allocation(s, "sector")}
    assert by_sector == {"Tech": 2000, "Unassigned": 2000}


def test_value_history_tracks_trades_and_price_marks():
    trades = [T(1, "buy", 10, 100, 1), T(2, "sell", 5, 130, 3)]
    prices = [("AAPL", date(2026, 1, 2), 110.0)]
    hist = value_history(trades, prices)
    assert [h["date"] for h in hist] == ["2026-01-01", "2026-01-02", "2026-01-03"]
    assert hist[0]["value"] == 1000  # last trade price
    assert hist[1]["value"] == 1100  # manual mark
    assert hist[2]["value"] == pytest.approx(5 * 110)  # 5 shares left, mark still latest


def test_empty_inputs():
    assert compute_positions([]) == {}
    assert value_history([], []) == []


# ---------- regression: review findings ----------
from app.portfolio import first_trade_order  # noqa: E402


def test_history_ignores_marks_for_tickers_never_held():
    trades = [T(1, "buy", 10, 100, 10)]  # first trade Jan 10
    marks = [("WATCHED", date(2026, 1, 2), 50.0), ("WATCHED", date(2026, 1, 20), 55.0)]
    hist = value_history(trades, marks)
    assert [h["date"] for h in hist] == ["2026-01-10"]  # no $0 ramp, no extra points
    assert hist[0]["value"] == 1000


def test_history_ignores_marks_before_first_trade_but_still_uses_them_as_price():
    trades = [T(1, "buy", 10, 100, 10)]
    marks = [("AAPL", date(2026, 1, 2), 90.0)]  # before the first trade
    hist = value_history(trades, marks)
    assert [h["date"] for h in hist] == ["2026-01-10"]
    assert hist[0]["value"] == 900  # the earlier mark is still the latest known price


def test_history_skips_non_trade_days_for_closed_tickers():
    trades = [T(1, "buy", 10, 100, 1), T(2, "sell", 10, 120, 2)]  # closed on day 2
    marks = [("AAPL", date(2026, 1, 5), 130.0)]
    assert [h["date"] for h in value_history(trades, marks)] == ["2026-01-01", "2026-01-02"]


def test_first_trade_order_includes_closed_tickers():
    trades = [
        T(1, "buy", 1, 10, 1, ticker="AAA"),
        T(2, "buy", 1, 10, 2, ticker="BBB"),
        T(3, "sell", 1, 12, 3, ticker="AAA"),
    ]
    assert first_trade_order(trades) == ["AAA", "BBB"]


def test_allocation_slots_stay_put_when_a_position_closes():
    # Tech's earliest ticker (AAPL) is fully sold; Energy's XOM was traded second.
    trades = [
        T(1, "buy", 1, 10, 1, ticker="AAPL"),
        T(2, "buy", 1, 10, 2, ticker="XOM"),
        T(3, "buy", 1, 10, 3, ticker="MSFT"),
        T(4, "sell", 1, 10, 4, ticker="AAPL"),
    ]
    meta = {
        "AAPL": {"sector": "Tech"}, "MSFT": {"sector": "Tech"}, "XOM": {"sector": "Energy"},
    }
    order = first_trade_order(trades)
    summary = build_summary(compute_positions(trades), {}, meta)
    slots = {s["label"]: s["slot"] for s in allocation(summary, "sector", order, meta)}
    assert slots == {"Tech": 0, "Energy": 1}  # Tech keeps slot 0 although AAPL is closed
    by_ticker = {s["label"]: s["slot"] for s in allocation(summary, "ticker", order, meta)}
    assert by_ticker == {"XOM": 1, "MSFT": 2}  # closed AAPL still reserves slot 0
