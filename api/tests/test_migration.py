"""A database created before accounts existed must upgrade in place without losing data."""

from app.db import connect, init_schema

# The single-user schema, as it shipped before accounts. Note: prices has no user_id.
LEGACY = """
CREATE TABLE holdings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL, name TEXT, sector TEXT, asset_class TEXT, UNIQUE (user_id, ticker));
CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL, side TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0, traded_at TEXT NOT NULL, note TEXT);
CREATE TABLE watchlist (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL, name TEXT, target_price REAL, note TEXT, UNIQUE (user_id, ticker));
CREATE TABLE prices (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL,
  price REAL NOT NULL, as_of TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual');
CREATE TABLE analyses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL, position_hash TEXT NOT NULL, personalized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, model TEXT NOT NULL, payload TEXT NOT NULL);
"""


def legacy_db(tmp_path):
    conn = connect(str(tmp_path / "legacy.db"))
    for stmt in LEGACY.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    conn.execute("INSERT INTO trades (ticker, side, shares, price, traded_at) VALUES ('AAPL','buy',10,100,'2026-01-01')")
    conn.execute("INSERT INTO prices (ticker, price, as_of) VALUES ('AAPL', 150, '2026-02-01')")
    conn.commit()
    return conn


def test_existing_data_and_price_marks_are_adopted_by_account_one(tmp_path):
    conn = legacy_db(tmp_path)
    init_schema(conn)
    assert conn.execute("SELECT user_id FROM prices").fetchall() == [(1,)]
    assert conn.execute("SELECT user_id, ticker FROM trades").fetchall() == [(1, "AAPL")]
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


def test_migration_is_idempotent_and_keeps_later_market_marks_shared(tmp_path):
    conn = legacy_db(tmp_path)
    init_schema(conn)
    conn.execute("INSERT INTO prices (user_id, ticker, price, as_of, source) VALUES (NULL, 'MSFT', 400, '2026-02-02', 'market')")
    conn.commit()
    init_schema(conn)  # second startup must not claim the shared mark for user 1
    owners = dict(conn.execute("SELECT ticker, user_id FROM prices").fetchall())
    assert owners == {"AAPL": 1, "MSFT": None}


def test_a_new_database_needs_no_migration_and_forbids_ownerless_rows(tmp_path):
    import pytest

    conn = connect(str(tmp_path / "new.db"))
    init_schema(conn)
    with pytest.raises(Exception):
        conn.execute("INSERT INTO trades (ticker, side, shares, price, traded_at) VALUES ('A','buy',1,1,'2026-01-01')")
