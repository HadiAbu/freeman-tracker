from pathlib import Path
from typing import Any, Iterator

import libsql

from app.config import get_settings

SCHEMA = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")


def connect(url: str, token: str = ""):
    kwargs = {"auth_token": token} if token else {}
    return libsql.connect(url, **kwargs)


def init_schema(conn) -> None:
    # Drop comment lines first so a ';' inside a comment can't split a statement.
    sql = "\n".join(l for l in SCHEMA.splitlines() if not l.lstrip().startswith("--"))
    for stmt in sql.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    _migrate(conn)
    conn.commit()


def _columns(conn, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _migrate(conn) -> None:
    """Brings a database created by an older version up to date. Safe to run every startup.

    Version 1 (single user) had no owner on price marks. Every mark that exists then was entered
    by the one user, who is account id 1: the first account created on that database inherits
    the data. Marks added later by a market-data provider have user_id NULL and are shared.
    """
    if "user_id" not in _columns(conn, "prices"):
        conn.execute("ALTER TABLE prices ADD COLUMN user_id INTEGER")
        conn.execute("UPDATE prices SET user_id = 1")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_ticker_asof ON prices (ticker, as_of)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prices_user ON prices (user_id, ticker, as_of)")
    _migrate_alerts(conn)


def _migrate_alerts(conn) -> None:
    """Price alerts: target_price became upper_limit and each limit gained a state.

    A limit the latest known price is already past starts 'triggered', so upgrading never sends an
    email for something that was true before the feature existed. This runs only the first time
    (while upper_state is missing): later startups must not re-evaluate states.
    """
    if "target_price" in _columns(conn, "watchlist") and "upper_limit" not in _columns(conn, "watchlist"):
        conn.execute("ALTER TABLE watchlist RENAME COLUMN target_price TO upper_limit")
    cols = _columns(conn, "watchlist")
    first_run = "upper_state" not in cols
    for name, ddl in (
        ("lower_limit", "REAL"),
        ("upper_state", "TEXT NOT NULL DEFAULT 'armed'"),
        ("lower_state", "TEXT NOT NULL DEFAULT 'armed'"),
        ("last_alerted_at", "TEXT"),
    ):
        if name not in cols:
            conn.execute(f"ALTER TABLE watchlist ADD COLUMN {name} {ddl}")
    if first_run:
        # Same "latest visible price" rule as ledger.latest_marks.
        conn.execute(
            "UPDATE watchlist SET upper_state = 'triggered' WHERE upper_limit IS NOT NULL AND"
            " (SELECT p.price FROM prices p WHERE p.ticker = watchlist.ticker"
            "  AND (p.user_id = watchlist.user_id OR p.user_id IS NULL)"
            "  ORDER BY p.as_of DESC, (p.user_id IS NULL) ASC, p.id DESC LIMIT 1)"
            " >= watchlist.upper_limit"
        )
    if "alert_email" not in _columns(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN alert_email TEXT")


def get_conn() -> Iterator[Any]:
    """FastAPI dependency: one connection per request."""
    s = get_settings()
    conn = connect(s.turso_database_url, s.turso_auth_token)
    try:
        yield conn
    finally:
        close = getattr(conn, "close", None)
        if close:
            close()


def rows(cur) -> list[dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def one(cur) -> dict | None:
    r = rows(cur)
    return r[0] if r else None
