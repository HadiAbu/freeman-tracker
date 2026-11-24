from datetime import datetime, timedelta, timezone

from app.analysis import store
from app.analysis.prompt import PositionInfo
from app.analysis.schema import Analysis

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)


def analysis(ticker="AAPL", when=NOW, personalized=False, stance="hold"):
    return Analysis(ticker=ticker, generated_at=when, cached=False, personalized=personalized, stance=stance,
                    confidence="low", summary="s", case_for=[], case_against=[], watch_for=[],
                    sources=[], notes=[], model="m")


def test_position_hash_is_stable_and_changes_with_the_position():
    a = PositionInfo(10, 100.0, 120.0, 20.0)
    assert store.position_hash(None) == "none"
    assert store.position_hash(a) == store.position_hash(PositionInfo(10, 100.0, 999.0, 1.0))  # price moves do not matter
    assert store.position_hash(a) != store.position_hash(PositionInfo(11, 100.0, 120.0, 20.0))
    assert store.position_hash(a) != store.position_hash(PositionInfo(10, 101.0, 120.0, 20.0))


def test_save_then_get_fresh_marks_the_result_cached(db_conn):
    store.save(db_conn, analysis(), ph="none", personalized=False, expires_at=NOW + timedelta(hours=6))
    got = store.get_fresh(db_conn, "AAPL", "none", False, NOW + timedelta(hours=1))
    assert got is not None and got.cached is True and got.ticker == "AAPL"


def test_expired_entries_are_not_fresh_but_are_still_the_latest(db_conn):
    store.save(db_conn, analysis(), ph="none", personalized=False, expires_at=NOW + timedelta(hours=6))
    later = NOW + timedelta(hours=7)
    assert store.get_fresh(db_conn, "AAPL", "none", False, later) is None
    assert store.get_latest(db_conn, "AAPL") is not None


def test_cache_key_includes_position_hash_and_personalization(db_conn):
    store.save(db_conn, analysis(personalized=True), ph="abc", personalized=True, expires_at=NOW + timedelta(hours=6))
    assert store.get_fresh(db_conn, "AAPL", "abc", True, NOW) is not None
    assert store.get_fresh(db_conn, "AAPL", "other", True, NOW) is None
    assert store.get_fresh(db_conn, "AAPL", "none", False, NOW) is None


def test_get_latest_returns_the_newest_and_none_for_unknown(db_conn):
    store.save(db_conn, analysis(when=NOW, stance="hold"), ph="none", personalized=False, expires_at=NOW + timedelta(hours=6))
    store.save(db_conn, analysis(when=NOW + timedelta(hours=1), stance="sell"), ph="none", personalized=False,
               expires_at=NOW + timedelta(hours=7))
    assert store.get_latest(db_conn, "AAPL").stance == "sell"
    assert store.get_latest(db_conn, "MSFT") is None


def test_last_created_and_count_since(db_conn):
    assert store.last_created(db_conn, "AAPL", "none", False) is None
    store.save(db_conn, analysis(when=NOW), ph="none", personalized=False, expires_at=NOW + timedelta(hours=6))
    store.save(db_conn, analysis("MSFT", when=NOW - timedelta(days=2)), ph="none", personalized=False,
               expires_at=NOW + timedelta(hours=6))
    assert store.last_created(db_conn, "AAPL", "none", False) == NOW
    assert store.count_since(db_conn, store.start_of_utc_day(NOW)) == 1
    assert store.count_since(db_conn, NOW - timedelta(days=3)) == 2


def test_refresh_wait_and_day_boundaries():
    assert store.refresh_wait_seconds(None, NOW, 15) == 0
    assert store.refresh_wait_seconds(NOW - timedelta(minutes=5), NOW, 15) == 600
    assert store.refresh_wait_seconds(NOW - timedelta(minutes=20), NOW, 15) == 0
    assert store.start_of_utc_day(NOW) == datetime(2026, 11, 17, 0, 0, tzinfo=timezone.utc)
    assert store.seconds_until_next_utc_day(NOW) == 12 * 3600


def test_iso_rejects_naive_datetimes():
    import pytest

    with pytest.raises(ValueError):
        store.iso(datetime(2026, 11, 17, 12, 0))


def test_day_helpers_reject_naive_datetimes():
    import pytest

    with pytest.raises(ValueError):
        store.start_of_utc_day(datetime(2026, 11, 17, 12, 0))
    with pytest.raises(ValueError):
        store.seconds_until_next_utc_day(datetime(2026, 11, 17, 12, 0))


def test_non_utc_aware_datetimes_convert_to_utc():
    plus5 = timezone(timedelta(hours=5))
    local = datetime(2026, 11, 17, 3, 0, tzinfo=plus5)  # 2026-11-16 22:00 UTC, previous UTC day
    assert store.iso(local) == "2026-11-16T22:00:00.000000Z"
    assert store.start_of_utc_day(local) == datetime(2026, 11, 16, 0, 0, tzinfo=timezone.utc)


def test_save_rejects_naive_generated_at_and_writes_nothing(db_conn):
    import pytest

    naive = analysis(when=datetime(2026, 11, 17, 12, 0))  # naive: no tzinfo
    with pytest.raises(ValueError):
        store.save(db_conn, naive, ph="none", personalized=False, expires_at=NOW + timedelta(hours=6))
    assert store.count_since(db_conn, datetime(2000, 1, 1, tzinfo=timezone.utc)) == 0
