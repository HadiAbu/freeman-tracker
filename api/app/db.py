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
    conn.commit()


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
