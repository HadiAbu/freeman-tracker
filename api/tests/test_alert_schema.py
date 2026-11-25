"""Existing databases must upgrade in place, and a limit already passed must not start armed."""

from app.db import connect, init_schema
from tests.test_migration import legacy_db


def columns(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def test_a_new_database_has_the_alert_columns(tmp_path):
    conn = connect(str(tmp_path / "new.db"))
    init_schema(conn)
    assert {"upper_limit", "lower_limit", "upper_state", "lower_state", "last_alerted_at"} <= columns(
        conn, "watchlist"
    )
    assert "target_price" not in columns(conn, "watchlist")
    assert "alert_email" in columns(conn, "users")


def seeded(tmp_path):
    conn = legacy_db(tmp_path)  # AAPL has a price of 150 from 2026-02-01
    conn.execute("INSERT INTO watchlist (ticker, target_price) VALUES ('AAPL', 150)")  # already reached
    conn.execute("INSERT INTO watchlist (ticker, target_price) VALUES ('MSFT', 500)")  # no price at all
    conn.execute("INSERT INTO watchlist (ticker, target_price) VALUES ('NVDA', 900)")
    conn.execute("INSERT INTO prices (ticker, price, as_of) VALUES ('NVDA', 800, '2026-02-01')")
    conn.commit()
    return conn


def limits(conn):
    return {
        r[0]: (r[1], r[2], r[3])
        for r in conn.execute(
            "SELECT ticker, upper_limit, upper_state, lower_limit FROM watchlist"
        ).fetchall()
    }


def test_target_price_becomes_the_upper_limit_and_a_reached_one_starts_triggered(tmp_path):
    conn = seeded(tmp_path)
    init_schema(conn)
    assert limits(conn) == {
        "AAPL": (150.0, "triggered", None),  # price 150 is already at the limit: no surprise email
        "MSFT": (500.0, "armed", None),
        "NVDA": (900.0, "armed", None),
    }
    assert "alert_email" in columns(conn, "users")


def test_running_the_migration_again_changes_nothing(tmp_path):
    conn = seeded(tmp_path)
    init_schema(conn)
    conn.execute("INSERT INTO prices (user_id, ticker, price, as_of) VALUES (1, 'AAPL', 100, '2026-03-01')")
    conn.execute("UPDATE watchlist SET upper_state = 'armed' WHERE ticker = 'AAPL'")
    conn.commit()
    before = limits(conn)
    init_schema(conn)  # a second start must not re-evaluate states
    assert limits(conn) == before
