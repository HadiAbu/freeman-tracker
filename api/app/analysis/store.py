import hashlib
from datetime import datetime, timedelta, timezone

from app.analysis.prompt import PositionInfo
from app.analysis.schema import Analysis
from app.db import one


def _require_aware(dt: datetime) -> datetime:
    """Naive datetimes would be read as machine-local time by astimezone(); refuse them."""
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("naive datetime: pass a timezone-aware value")
    return dt


def iso(dt: datetime) -> str:
    """Fixed-width UTC timestamp, so string comparison orders correctly."""
    return _require_aware(dt).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def position_hash(position: PositionInfo | None) -> str:
    """Changes when shares or average cost change (price moves do not invalidate the cache)."""
    if position is None:
        return "none"
    raw = f"{position.shares:.6f}|{position.avg_cost:.4f}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def save(conn, analysis: Analysis, *, ph: str, personalized: bool, expires_at: datetime) -> None:
    # Convert both timestamps before touching the database, so a bad value writes nothing.
    created = iso(analysis.generated_at)
    expires = iso(expires_at)
    conn.execute(
        "INSERT INTO analyses (ticker, position_hash, personalized, created_at, expires_at, model, payload)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            analysis.ticker, ph, 1 if personalized else 0, created,
            expires, analysis.model, analysis.model_dump_json(),
        ),
    )
    conn.commit()


def _load(row: dict | None) -> Analysis | None:
    if not row:
        return None
    return Analysis.model_validate_json(row["payload"]).model_copy(update={"cached": True})


def get_fresh(conn, ticker: str, ph: str, personalized: bool, now: datetime) -> Analysis | None:
    return _load(one(conn.execute(
        "SELECT payload FROM analyses WHERE user_id = 1 AND ticker = ? AND position_hash = ?"
        " AND personalized = ? AND expires_at > ? ORDER BY created_at DESC, id DESC LIMIT 1",
        (ticker, ph, 1 if personalized else 0, iso(now)),
    )))


def get_latest(conn, ticker: str) -> Analysis | None:
    return _load(one(conn.execute(
        "SELECT payload FROM analyses WHERE user_id = 1 AND ticker = ?"
        " ORDER BY created_at DESC, id DESC LIMIT 1",
        (ticker,),
    )))


def last_created(conn, ticker: str, ph: str, personalized: bool) -> datetime | None:
    row = one(conn.execute(
        "SELECT created_at FROM analyses WHERE user_id = 1 AND ticker = ? AND position_hash = ?"
        " AND personalized = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        (ticker, ph, 1 if personalized else 0),
    ))
    return _parse(row["created_at"]) if row else None


def count_since(conn, since: datetime) -> int:
    row = one(conn.execute(
        "SELECT COUNT(*) AS n FROM analyses WHERE user_id = 1 AND created_at >= ?", (iso(since),)
    ))
    return int(row["n"]) if row else 0


def refresh_wait_seconds(last: datetime | None, now: datetime, min_minutes: int) -> int:
    if last is None:
        return 0
    remaining = timedelta(minutes=min_minutes) - (now - last)
    return max(0, int(remaining.total_seconds()))


def start_of_utc_day(now: datetime) -> datetime:
    return _require_aware(now).astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def seconds_until_next_utc_day(now: datetime) -> int:
    _require_aware(now)
    return int((start_of_utc_day(now) + timedelta(days=1) - now).total_seconds())
