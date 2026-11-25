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
    # AAPL's price (150) is still at its limit, so re-evaluating would flip this back to triggered.
    conn.execute("UPDATE watchlist SET upper_state = 'armed' WHERE ticker = 'AAPL'")
    conn.commit()
    before = limits(conn)
    assert before["AAPL"][1] == "armed"
    init_schema(conn)  # a second start must not re-evaluate states
    assert limits(conn) == before


def test_a_migration_interrupted_before_the_evaluation_is_finished_on_the_next_start(tmp_path):
    conn = seeded(tmp_path)
    # The state a crash leaves behind: the ALTERs autocommitted, the evaluation UPDATE never did,
    # and the column added after it does not exist yet.
    conn.execute("ALTER TABLE prices ADD COLUMN user_id INTEGER")
    conn.execute("UPDATE prices SET user_id = 1")
    conn.execute("ALTER TABLE watchlist RENAME COLUMN target_price TO upper_limit")
    for ddl in (
        "lower_limit REAL",
        "upper_state TEXT NOT NULL DEFAULT 'armed'",
        "lower_state TEXT NOT NULL DEFAULT 'armed'",
    ):
        conn.execute(f"ALTER TABLE watchlist ADD COLUMN {ddl}")
    conn.commit()
    assert "last_alerted_at" not in columns(conn, "watchlist")

    init_schema(conn)
    assert limits(conn)["AAPL"][1] == "triggered"
    assert limits(conn)["NVDA"][1] == "armed"
    assert "last_alerted_at" in columns(conn, "watchlist")


def test_the_evaluation_is_committed_before_the_column_that_marks_it_done_is_added(tmp_path):
    conn = seeded(tmp_path)
    committed_state_seen = []

    class Watching:
        """Looks from a second connection just before last_alerted_at is added."""

        def execute(self, sql, *args):
            if "ADD COLUMN last_alerted_at" in sql:
                other = connect(str(tmp_path / "legacy.db"))
                committed_state_seen.append(
                    other.execute(
                        "SELECT upper_state FROM watchlist WHERE ticker = 'AAPL'"
                    ).fetchone()
                )
            return conn.execute(sql, *args)

        def commit(self):
            conn.commit()

    init_schema(Watching())
    assert committed_state_seen == [("triggered",)]
