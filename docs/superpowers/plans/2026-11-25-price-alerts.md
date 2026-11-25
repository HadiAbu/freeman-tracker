# Price Alerts by Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each watchlist item carry an upper and a lower price limit and email the user when the price reaches either, using a background check inside the API server.

**Architecture:** A pure `run_check` function compares fresh Finnhub quotes with every stored limit, and a state machine (`armed` / `triggered`, plus a 1 hour cooldown) decides when to email through a small SMTP mailer. A daemon thread started from the FastAPI lifespan calls it every 120 seconds. The app gets two limit fields, new row text and a small "Email alerts" screen for the destination address and a test email.

**Tech Stack:** FastAPI, libsql (SQLite 3.45), pydantic-settings, Python `smtplib` and `email`, pytest; Expo SDK 58 / React Native 0.88, TanStack Query, Jest with React Native Testing Library v14 (async `render` / `fireEvent`).

**Spec:** `docs/superpowers/specs/2026-11-25-price-alerts-design.md` (read it with this plan).

## Global Constraints

- Email only. No push notifications, no SMS, no new native module, no new native build.
- The checker runs inside the API server on the user's PC, every `ALERT_CHECK_SECONDS` = 120.
- Email goes through `smtplib` with Gmail defaults: `smtp.gmail.com`, port 587, STARTTLS, 10 second timeout. Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. The password is never logged or returned by the API.
- An alert fires once, then re-arms when the price is back inside the limits. Cooldown: at most one email per watchlist item per hour.
- Existing `target_price` becomes `upper_limit`; `lower_limit` is new. Alerts apply to watchlist items only.
- Limits are positive, and `lower_limit < upper_limit` when both are set.
- A limit the latest known price is already beyond starts `triggered` (no surprise email). This applies to the migration and to every create or edit.
- Alert emails contain only ticker, company name, price, limits, change versus previous close, the user's note and the check time. Never share counts, cost basis, balances or portfolio value.
- `alert_email` is separate from the login email and never falls back to it.
- At most 50 tickers and 20 emails per cycle. A quote used by the checker is at most 60 seconds old.
- App code: strict TypeScript, no `any`, `import type` for type-only imports, Prettier (`npm run format:check`), imports through `@/`, new components get a test beside them. RNTL v14: `await render(...)`, `await fireEvent...`.
- Python tests run from `api/` with `.venv/Scripts/python -m pytest -q`. App tests run from the repo root with `npx jest`.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

Backend (`api/`):

| File | Responsibility |
| --- | --- |
| `app/config.py` (modify) | SMTP and alert settings, `email_configured`, `email_sender` |
| `app/quotes.py` (modify) | `Quote.previous_close`, `QuoteCache.get(max_age=...)` |
| `app/schema.sql`, `app/db.py` (modify) | New columns, rename, state initialisation |
| `app/alerts.py` (create) | `beyond`, `initial_state`, `decide`, `run_check`, `CheckResult` |
| `app/alert_email.py` (create) | `AlertDetails`, `compose` (pure text) |
| `app/mailer.py` (create) | `Mailer` protocol, `MailError`, `SmtpMailer` |
| `app/alert_routes.py` (create) | `GET/PUT /alerts/settings`, `POST /alerts/test`, `get_mailer` |
| `app/alert_loop.py` (create) | `start_alert_loop` (the background thread) |
| `app/models.py`, `app/main.py`, `app/ledger.py` (modify) | Limits on the watchlist API, `latest_price`, router and lifespan wiring |

App (`src/`): `types.ts`, `lib/api.ts`, `hooks/use-alert-settings.ts` (create), `app/add-watch.tsx`, `components/rows/watch-row.tsx`, `app/alert-settings.tsx` (create), `app/(tabs)/watchlist.tsx`, `app/_layout.tsx`, `test-utils/fixtures.ts`, and their tests.

---

### Task 1: Settings, quote previous close, quote cache age, spec alignment

**Files:**
- Modify: `api/app/config.py`
- Modify: `api/app/quotes.py`
- Modify: `docs/superpowers/specs/2026-11-25-price-alerts-design.md`
- Create: `api/tests/test_config_alerts.py`
- Create: `api/tests/test_quote_extras.py`

**Interfaces:**
- Produces: `Settings.smtp_host/smtp_port/smtp_user/smtp_password/smtp_from`, `Settings.alert_check_seconds` (120), `Settings.alert_cooldown_seconds` (3600), `Settings.email_configured -> bool`, `Settings.email_sender -> str`; `Quote.previous_close: float | None = None`; `QuoteCache.get(ticker, max_age: float | None = None) -> Quote | None`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_config_alerts.py`:

```python
from app.config import Settings


def test_defaults_match_the_design():
    s = Settings(_env_file=None)
    assert (s.smtp_host, s.smtp_port) == ("smtp.gmail.com", 587)
    assert s.alert_check_seconds == 120
    assert s.alert_cooldown_seconds == 3600


def test_email_is_configured_only_with_a_user_and_a_password():
    assert not Settings(smtp_user="", smtp_password="", _env_file=None).email_configured
    assert not Settings(smtp_user="me@gmail.com", smtp_password="", _env_file=None).email_configured
    assert Settings(
        smtp_user="me@gmail.com", smtp_password="app-password", _env_file=None
    ).email_configured


def test_the_sender_defaults_to_the_smtp_user():
    assert Settings(smtp_user="me@gmail.com", _env_file=None).email_sender == "me@gmail.com"
    assert (
        Settings(smtp_user="me@gmail.com", smtp_from="alerts@x.com", _env_file=None).email_sender
        == "alerts@x.com"
    )
```

`api/tests/test_quote_extras.py`:

```python
from datetime import date

import httpx
import pytest

from app.quotes import FinnhubQuotes, Quote, QuoteCache


def finnhub(payload):
    return FinnhubQuotes("k", transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))


def test_a_quote_carries_the_previous_close():
    q = finnhub({"c": 190.5, "pc": 188.0, "t": 0}).quote("AAPL")
    assert q.price == 190.5 and q.previous_close == 188.0


@pytest.mark.parametrize("pc", [0, -1, None, "188", True])
def test_a_missing_or_bad_previous_close_is_none_and_the_quote_still_works(pc):
    q = finnhub({"c": 190.5, "pc": pc, "t": 0}).quote("AAPL")
    assert q.price == 190.5 and q.previous_close is None


def test_cache_get_can_refuse_entries_older_than_max_age():
    now = [0.0]
    cache = QuoteCache(120, clock=lambda: now[0])
    cache.put(Quote("AAPL", 1.0, date(2026, 1, 1)))
    now[0] = 59
    assert cache.get("AAPL", max_age=60) is not None
    now[0] = 61
    assert cache.get("AAPL", max_age=60) is None  # too old for the checker
    assert cache.get("AAPL") is not None  # still within the normal 120 s ttl
    now[0] = 121
    assert cache.get("AAPL") is None
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `api/`): `.venv/Scripts/python -m pytest -q tests/test_config_alerts.py tests/test_quote_extras.py`
Expected: FAIL (`email_configured` missing, `previous_close` unexpected, `max_age` unexpected).

- [ ] **Step 3: Implement**

In `api/app/config.py`, after the `cors_origins` line add:

```python
    # --- email alerts (Gmail by default: use an app password, never the account password) ---
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""  # defaults to smtp_user
    alert_check_seconds: int = 120
    alert_cooldown_seconds: int = 3600
```

and inside the `Settings` class, before the `jwt_secret` validator, add:

```python
    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_user and self.smtp_password)

    @property
    def email_sender(self) -> str:
        return self.smtp_from or self.smtp_user
```

In `api/app/quotes.py` replace the `Quote` dataclass:

```python
@dataclass(frozen=True)
class Quote:
    ticker: str
    price: float
    as_of: date  # the day of the last trade, so a weekend refresh reports Friday
    previous_close: float | None = None  # yesterday's close; None when the provider sent none
```

and replace the final `return Quote(...)` line of `FinnhubQuotes.quote` with:

```python
        pc = data.get("pc")
        previous = (
            float(pc)
            if isinstance(pc, (int, float)) and not isinstance(pc, bool) and math.isfinite(pc) and pc > 0
            else None
        )
        return Quote(ticker, float(price), _trade_day(data.get("t"), today), previous)
```

and replace `QuoteCache.get`:

```python
    def get(self, ticker: str, max_age: float | None = None) -> Quote | None:
        """The cached quote, if younger than the ttl (and than `max_age`, when given)."""
        limit = self.ttl if max_age is None else min(self.ttl, max_age)
        with self._lock:
            hit = self._items.get(ticker)
            if hit and self._clock() - hit[0] < limit:
                return hit[1]
            return None
```

- [ ] **Step 4: Align the spec with two decisions made while planning**

Run from the repo root:

```bash
python - <<'EOF'
p = 'docs/superpowers/specs/2026-11-25-price-alerts-design.md'
s = open(p, encoding='utf-8').read()
pairs = [
 ("| Cooldown | At most one email per limit per hour, so a price flickering around a limit cannot flood the inbox |",
  "| Cooldown | At most one email per watchlist item per hour (one `last_alerted_at` per item), so a price flickering around a limit cannot flood the inbox |"),
 ("- **Alert email screen** (opened from the account button): the address field,",
  "- **Alert email screen** (opened from an \"Email alerts\" button under the Watchlist header; the account button only signs out): the address field,"),
 ("- A lower-limit email reads",
  "- `Price as of` is the time of the check; when the last trade was on an earlier day (a weekend or holiday) it adds `, last trade 2026-11-24` inside the brackets.\n- A lower-limit email reads"),
]
for old, new in pairs:
    assert old in s, old[:50]
    s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
EOF
```

- [ ] **Step 5: Run the tests**

Run (from `api/`): `.venv/Scripts/python -m pytest -q`
Expected: all pass (270 existing plus 8 new).

- [ ] **Step 6: Commit**

```bash
git add api/app/config.py api/app/quotes.py api/tests/test_config_alerts.py api/tests/test_quote_extras.py docs/superpowers/specs/2026-11-25-price-alerts-design.md
git commit -m "feat(api): alert settings, quote previous close and cache max age

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema and migration

**Files:**
- Modify: `api/app/schema.sql`
- Modify: `api/app/db.py`
- Create: `api/tests/test_alert_schema.py`

**Interfaces:**
- Produces: table `watchlist(id, user_id, ticker, name, upper_limit REAL, lower_limit REAL, upper_state TEXT, lower_state TEXT, last_alerted_at TEXT, note)`; column `users.alert_email TEXT`. States are the strings `'armed'` and `'triggered'`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_schema.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_schema.py`
Expected: FAIL (`no such column: upper_limit` or similar).

- [ ] **Step 3: Implement**

In `api/app/schema.sql`, change the `users` table by replacing

```
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

with

```
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Where price alerts are sent. Separate from the login email, which can be a placeholder.
  alert_email TEXT
);
```

and replace the `watchlist` table with:

```
-- upper_limit / lower_limit: email the user when the price reaches them. A state is 'armed'
-- (will email on the next crossing) or 'triggered' (already past the limit, quiet until the price
-- crosses back). last_alerted_at is when this item last sent an email.
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  upper_limit REAL,
  lower_limit REAL,
  upper_state TEXT NOT NULL DEFAULT 'armed',
  lower_state TEXT NOT NULL DEFAULT 'armed',
  last_alerted_at TEXT,
  note TEXT,
  UNIQUE (user_id, ticker)
);
```

In `api/app/db.py`, at the end of `_migrate` (after the two `CREATE INDEX` lines) add `_migrate_alerts(conn)`, and add this function below `_migrate`:

```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_schema.py tests/test_migration.py`
Expected: PASS. (Other tests that post `target_price` fail until Task 3; run the full suite after it.)

- [ ] **Step 5: Commit**

```bash
git add api/app/schema.sql api/app/db.py api/tests/test_alert_schema.py
git commit -m "feat(api): watchlist limits, alert states and alert_email columns, with migration

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Watchlist API with limits, validation and state initialisation

**Files:**
- Create: `api/app/alerts.py` (state helpers only for now)
- Modify: `api/app/ledger.py`
- Modify: `api/app/models.py`
- Modify: `api/app/main.py:166-218`
- Modify: `api/tests/test_api.py:82-90`, `api/tests/test_isolation.py:43-46`
- Create: `api/tests/test_alert_state.py`, `api/tests/test_watch_limits.py`

**Interfaces:**
- Produces: `app.alerts.ARMED = "armed"`, `TRIGGERED = "triggered"`, `beyond(side: str, price: float, limit: float) -> bool` (`side` is `"upper"` or `"lower"`), `initial_state(side: str, price: float | None, limit: float | None) -> str`; `ledger.latest_price(conn, user_id, ticker) -> float | None`. Watchlist JSON fields: `upper_limit`, `lower_limit`, `upper_state`, `lower_state`, `last_alerted_at`, `pct_to_target` (distance to the upper limit).

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_state.py`:

```python
import pytest

from app.alerts import ARMED, TRIGGERED, beyond, initial_state


@pytest.mark.parametrize(
    "side,price,limit,expected",
    [
        ("upper", 190, 190, True),  # reaching the limit counts
        ("upper", 189.99, 190, False),
        ("upper", 200, 190, True),
        ("lower", 150, 150, True),
        ("lower", 150.01, 150, False),
        ("lower", 100, 150, True),
    ],
)
def test_beyond(side, price, limit, expected):
    assert beyond(side, price, limit) is expected


def test_a_new_limit_the_price_is_already_past_starts_triggered():
    assert initial_state("upper", 200, 190) == TRIGGERED
    assert initial_state("lower", 100, 150) == TRIGGERED


def test_a_new_limit_the_price_has_not_reached_starts_armed():
    assert initial_state("upper", 180, 190) == ARMED
    assert initial_state("lower", 180, 150) == ARMED


def test_no_price_or_no_limit_starts_armed():
    assert initial_state("upper", None, 190) == ARMED
    assert initial_state("upper", 180, None) == ARMED
```

`api/tests/test_watch_limits.py`:

```python
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
```

- [ ] **Step 2: Update the two existing tests that still use the old field name**

Run from the repo root:

```bash
sed -i 's/target_price/upper_limit/g' api/tests/test_api.py api/tests/test_isolation.py
```

- [ ] **Step 3: Run to verify the new tests fail**

Run (from `api/`): `.venv/Scripts/python -m pytest -q tests/test_alert_state.py tests/test_watch_limits.py`
Expected: FAIL (`app.alerts` missing, limits not accepted).

- [ ] **Step 4: Implement**

Create `api/app/alerts.py`:

```python
"""Price alerts: when a limit counts as reached, and what state a limit starts in."""

ARMED = "armed"  # will email the next time the price reaches the limit
TRIGGERED = "triggered"  # already past the limit; quiet until the price crosses back


def beyond(side: str, price: float, limit: float) -> bool:
    """True when `price` has reached `limit`. Reaching it counts: >= for upper, <= for lower."""
    return price >= limit if side == "upper" else price <= limit


def initial_state(side: str, price: float | None, limit: float | None) -> str:
    """State for a limit that was just created or changed.

    A limit the price is already past starts 'triggered', so setting it never sends an email about
    something that was already true. It emails only after the price comes back and crosses again.
    """
    if limit is None or price is None:
        return ARMED
    return TRIGGERED if beyond(side, price, limit) else ARMED
```

In `api/app/ledger.py`, after `latest_prices`, add:

```python
def latest_price(conn, user_id: int, ticker: str) -> float | None:
    """Newest visible price for one ticker (same rule as latest_marks), or None."""
    r = one(
        conn.execute(
            f"SELECT price FROM prices WHERE ticker = ? AND {PRICE_VISIBLE}"
            f" ORDER BY {_LATEST_ORDER} LIMIT 1",
            (ticker, user_id),
        )
    )
    return r["price"] if r else None
```

In `api/app/models.py`, replace `WatchIn` and `WatchPatch`:

```python
class WatchIn(BaseModel):
    ticker: str
    name: Optional[str] = None
    upper_limit: Optional[float] = Field(default=None, gt=0)  # email when the price reaches it
    lower_limit: Optional[float] = Field(default=None, gt=0)  # email when it falls to it
    note: Optional[str] = None
    _t = field_validator("ticker")(_ticker)


class WatchPatch(BaseModel):
    name: Optional[str] = None
    upper_limit: Optional[float] = Field(default=None, gt=0)
    lower_limit: Optional[float] = Field(default=None, gt=0)
    note: Optional[str] = None
```

In `api/app/main.py`: add `from app.alerts import ARMED, initial_state` to the imports, add `latest_price as _latest_price,` inside the `from app.ledger import (...)` list, and replace everything from the `# ---------- watchlist ----------` comment through the end of `patch_watch` (stop before `@app.delete("/watchlist/{item_id}"`) with:

```python
# ---------- watchlist ----------
def _check_limits(upper: float | None, lower: float | None) -> None:
    if upper is not None and lower is not None and lower >= upper:
        raise HTTPException(422, "The lower limit must be below the upper limit.")


def _limit_states(conn, uid: int, ticker: str, upper, lower, old: dict | None) -> dict:
    """The alert state to store for each limit. A limit that did not change keeps its state; a new
    or changed one is judged against the latest price (see alerts.initial_state)."""
    price = _latest_price(conn, uid, ticker)
    states = {}
    for side, new in (("upper", upper), ("lower", lower)):
        if new is None:
            states[f"{side}_state"] = ARMED
        elif old is not None and old[f"{side}_limit"] == new:
            states[f"{side}_state"] = old[f"{side}_state"]
        else:
            states[f"{side}_state"] = initial_state(side, price, new)
    return states


@app.post("/watchlist", status_code=201)
def add_watch(body: WatchIn, uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    _check_limits(body.upper_limit, body.lower_limit)
    old = one(
        conn.execute("SELECT * FROM watchlist WHERE user_id = ? AND ticker = ?", (uid, body.ticker))
    )
    st = _limit_states(conn, uid, body.ticker, body.upper_limit, body.lower_limit, old)
    conn.execute(
        "INSERT INTO watchlist (user_id, ticker, name, upper_limit, lower_limit, upper_state,"
        " lower_state, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET name = excluded.name,"
        " upper_limit = excluded.upper_limit, lower_limit = excluded.lower_limit,"
        " upper_state = excluded.upper_state, lower_state = excluded.lower_state,"
        " note = excluded.note",
        (
            uid, body.ticker, body.name, body.upper_limit, body.lower_limit,
            st["upper_state"], st["lower_state"], body.note,
        ),
    )
    conn.commit()
    return one(
        conn.execute("SELECT * FROM watchlist WHERE user_id = ? AND ticker = ?", (uid, body.ticker))
    )


@app.get("/watchlist")
def list_watch(uid: int = Depends(current_user_id), conn=Depends(get_conn)):
    latest = _latest_marks(conn, uid)
    items = rows(conn.execute("SELECT * FROM watchlist WHERE user_id = ? ORDER BY ticker", (uid,)))
    for w in items:
        mark = latest.get(w["ticker"])
        w["price"] = mark["price"] if mark else None
        w["price_as_of"] = mark["as_of"] if mark else None
        w["price_kind"] = _price_kind(mark["source"]) if mark else None
        t = w["upper_limit"]
        w["pct_to_target"] = (
            (t - w["price"]) / w["price"] * 100 if t is not None and w["price"] else None
        )
    return items


@app.patch("/watchlist/{item_id}")
def patch_watch(
    item_id: int, body: WatchPatch, uid: int = Depends(current_user_id), conn=Depends(get_conn)
):
    old = one(conn.execute("SELECT * FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid)))
    if not old:
        raise HTTPException(404, "Watchlist item not found")
    changes = body.model_dump(exclude_unset=True)
    upper = changes.get("upper_limit", old["upper_limit"])
    lower = changes.get("lower_limit", old["lower_limit"])
    _check_limits(upper, lower)
    if "upper_limit" in changes or "lower_limit" in changes:
        changes.update(_limit_states(conn, uid, old["ticker"], upper, lower, old))
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(
            f"UPDATE watchlist SET {sets} WHERE id = ? AND user_id = ?",
            (*changes.values(), item_id, uid),
        )
        conn.commit()
    return one(conn.execute("SELECT * FROM watchlist WHERE id = ? AND user_id = ?", (item_id, uid)))
```

- [ ] **Step 5: Run the whole API suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/app/alerts.py api/app/ledger.py api/app/models.py api/app/main.py api/tests
git commit -m "feat(api): upper and lower limits on the watchlist with alert states

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The email text and the SMTP mailer

**Files:**
- Create: `api/app/alert_email.py`
- Create: `api/app/mailer.py`
- Create: `api/tests/test_alert_email.py`, `api/tests/test_mailer.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AlertDetails` (dataclass fields: `ticker: str, name: str | None, side: str, price: float, limit: float, upper_limit: float | None, lower_limit: float | None, previous_close: float | None, note: str | None, checked_at: str, last_trade_day: str | None, cooldown_seconds: int`) and `compose(d: AlertDetails) -> tuple[str, str]` returning `(subject, body)`; `Mailer` protocol with `send(to: str, subject: str, body: str) -> None`; `MailError(Exception)`; `SmtpMailer(host, port, user, password, sender, timeout=10.0, smtp_factory=smtplib.SMTP)`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_email.py`:

```python
from app.alert_email import AlertDetails, compose


def details(**over):
    base = dict(
        ticker="AAPL", name="Apple Inc", side="upper", price=190.12, limit=190.0,
        upper_limit=190.0, lower_limit=150.0, previous_close=186.76, note="Wait for earnings",
        checked_at="2026-11-25 15:42 UTC", last_trade_day=None, cooldown_seconds=3600,
    )
    base.update(over)
    return AlertDetails(**base)


def test_an_upper_limit_email_has_every_detail():
    subject, body = compose(details())
    assert subject == "AAPL rose above your upper limit ($190.00)"
    assert "Apple Inc (AAPL) is $190.12, above your upper limit of $190.00 (+0.06%)." in body
    assert "Today:        +1.8% vs yesterday's close of $186.76" in body
    assert "Your limits:  lower $150.00 · upper $190.00" in body
    assert "Your note:    Wait for earnings" in body
    assert "Price as of:  2026-11-25 15:42 UTC (Finnhub)" in body
    assert "at most once an hour" in body


def test_a_lower_limit_email_says_fell_below():
    subject, body = compose(details(side="lower", price=149.0, limit=150.0))
    assert subject == "AAPL fell below your lower limit ($150.00)"
    assert "is $149.00, below your lower limit of $150.00 (-0.67%)." in body


def test_missing_data_leaves_its_line_out():
    _, body = compose(
        details(name=None, note=None, previous_close=None, lower_limit=None, upper_limit=190.0)
    )
    assert body.startswith("AAPL is $190.12, above")
    assert "Your note" not in body and "Today:" not in body
    assert "Your limits:  upper $190.00" in body


def test_a_last_trade_on_an_earlier_day_is_mentioned():
    _, body = compose(details(last_trade_day="2026-11-24"))
    assert "(Finnhub, last trade 2026-11-24)" in body


def test_the_cooldown_text_follows_the_setting():
    assert "at most once every 30 minutes" in compose(details(cooldown_seconds=1800))[1]
    assert "at most once every 2 hours" in compose(details(cooldown_seconds=7200))[1]


def test_free_text_cannot_break_out_of_its_line_or_reach_the_subject():
    subject, body = compose(
        details(name="Evil\r\nBcc: someone@else.com", note="line one\nline two", ticker="AAPL\nX")
    )
    assert "\n" not in subject and "\r" not in subject
    assert "Bcc: someone@else.com" in body  # kept as text...
    assert "\nBcc:" not in body  # ...but never at the start of a line
    assert "line one line two" in body


def test_nothing_about_holdings_is_in_the_text():
    subject, body = compose(details())
    text = (subject + body).lower()
    for word in ("shares", "cost basis", "balance", "portfolio"):
        assert word not in text
```

`api/tests/test_mailer.py`:

```python
import smtplib

import pytest

from app.mailer import MailError, SmtpMailer


class FakeSMTP:
    log: list = []
    fail_on: str | None = None

    def __init__(self, host, port, timeout):
        FakeSMTP.log.append(("connect", host, port, timeout))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        FakeSMTP.log.append(("starttls",))
        if FakeSMTP.fail_on == "tls":
            raise smtplib.SMTPException("tls")

    def login(self, user, password):
        FakeSMTP.log.append(("login", user, password))
        if FakeSMTP.fail_on == "login":
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials for hunter2")

    def send_message(self, msg):
        FakeSMTP.log.append(("send", msg))


@pytest.fixture(autouse=True)
def reset():
    FakeSMTP.log = []
    FakeSMTP.fail_on = None


def mailer():
    return SmtpMailer(
        host="smtp.gmail.com", port=587, user="me@gmail.com", password="hunter2",
        sender="me@gmail.com", timeout=10.0, smtp_factory=FakeSMTP,
    )


def test_it_connects_secures_the_link_logs_in_then_sends():
    mailer().send("you@example.com", "Subject here", "Body here")
    assert [e[0] for e in FakeSMTP.log] == ["connect", "starttls", "login", "send"]
    assert FakeSMTP.log[0] == ("connect", "smtp.gmail.com", 587, 10.0)
    msg = FakeSMTP.log[-1][1]
    assert (msg["From"], msg["To"], msg["Subject"]) == ("me@gmail.com", "you@example.com", "Subject here")
    assert "Body here" in msg.get_content()


def test_non_ascii_text_is_sent_as_utf8():
    mailer().send("you@example.com", "Sub", "lower $1 · upper $2")
    assert "lower $1 · upper $2" in FakeSMTP.log[-1][1].get_content()


def test_a_failed_login_becomes_a_mail_error_that_never_shows_the_password():
    FakeSMTP.fail_on = "login"
    with pytest.raises(MailError) as e:
        mailer().send("you@example.com", "s", "b")
    assert "hunter2" not in str(e.value)
    assert "SMTPAuthenticationError" in str(e.value)


def test_a_connection_failure_becomes_a_mail_error():
    def refuse(host, port, timeout):
        raise ConnectionRefusedError("nope")

    m = SmtpMailer("h", 587, "u", "p", "u", smtp_factory=refuse)
    with pytest.raises(MailError):
        m.send("you@example.com", "s", "b")


def test_a_header_with_a_newline_is_refused_not_sent():
    with pytest.raises(MailError):
        mailer().send("you@example.com", "Subject\r\nBcc: x@y.com", "b")
    assert not any(e[0] == "send" for e in FakeSMTP.log)
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_email.py tests/test_mailer.py`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`api/app/alert_email.py`:

```python
"""The text of an alert email. Pure (no network), so every line is easy to test.

What goes in: ticker, company name, price, limits, change since the previous close, the user's own
note and the check time. What never does: share counts, cost basis, balances, portfolio value.
Email is not private, and an alert does not need them.
"""

import re
from dataclasses import dataclass

_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def clean(text: str, limit: int = 200) -> str:
    """Free text on one line: control characters (newlines included) become spaces."""
    return _CONTROL.sub(" ", text).strip()[:limit]


def money(x: float) -> str:
    return f"${x:,.2f}"


def _every(seconds: int) -> str:
    if seconds % 3600 == 0:
        hours = seconds // 3600
        return "once an hour" if hours == 1 else f"once every {hours} hours"
    return f"once every {max(1, round(seconds / 60))} minutes"


@dataclass(frozen=True)
class AlertDetails:
    ticker: str
    name: str | None
    side: str  # "upper" or "lower"
    price: float
    limit: float  # the limit that was reached
    upper_limit: float | None
    lower_limit: float | None
    previous_close: float | None
    note: str | None
    checked_at: str  # e.g. "2026-11-25 15:42 UTC"
    last_trade_day: str | None  # set only when the last trade was not today (weekend, holiday)
    cooldown_seconds: int


def compose(d: AlertDetails) -> tuple[str, str]:
    """Returns (subject, body). The subject holds only the ticker and numbers."""
    above = d.side == "upper"
    ticker = clean(d.ticker, 15)
    word = "rose above your upper limit" if above else "fell below your lower limit"
    subject = f"{ticker} {word} ({money(d.limit)})"

    name = clean(d.name) if d.name else ""
    who = f"{name} ({ticker})" if name else ticker
    past = (d.price - d.limit) / d.limit * 100
    direction = "above" if above else "below"
    lines = [
        f"{who} is {money(d.price)}, {direction} your {d.side} limit of {money(d.limit)} ({past:+.2f}%).",
        "",
    ]

    def row(label: str, value: str) -> None:
        lines.append(f"{label:<14}{value}")

    if d.previous_close:
        change = (d.price - d.previous_close) / d.previous_close * 100
        row("Today:", f"{change:+.1f}% vs yesterday's close of {money(d.previous_close)}")
    limits = []
    if d.lower_limit is not None:
        limits.append(f"lower {money(d.lower_limit)}")
    if d.upper_limit is not None:
        limits.append(f"upper {money(d.upper_limit)}")
    row("Your limits:", " · ".join(limits))
    note = clean(d.note) if d.note else ""
    if note:
        row("Your note:", note)
    trade = f", last trade {d.last_trade_day}" if d.last_trade_day else ""
    row("Price as of:", f"{d.checked_at} (Finnhub{trade})")
    lines += [
        "",
        "You will be emailed again only after the price returns between your limits and",
        f"crosses one again (at most {_every(d.cooldown_seconds)}). Change or remove limits in the app.",
    ]
    return subject, "\n".join(lines)
```

`api/app/mailer.py`:

```python
"""Sending email over SMTP (Gmail by default). Behind a small interface so tests use a fake."""

import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol


class MailError(Exception):
    """An email could not be sent. The message is safe to log and to show: it never carries the
    password, the server's own wording, or the address."""


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpMailer:
    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        sender: str,
        timeout: float = 10.0,
        smtp_factory=smtplib.SMTP,
    ):
        self._host, self._port, self._timeout = host, port, timeout
        self._user, self._password, self._sender = user, password, sender
        self._factory = smtp_factory

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        try:
            # EmailMessage refuses a header containing a newline: a second line of defence behind
            # alert_email.clean, so a stray CR/LF can never inject a header.
            msg["From"] = self._sender
            msg["To"] = to
            msg["Subject"] = subject
            msg.set_content(body)
        except ValueError:
            raise MailError("email could not be built (bad header)") from None
        failure: str | None = None
        try:
            with self._factory(self._host, self._port, timeout=self._timeout) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(self._user, self._password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as e:
            failure = type(e).__name__
        if failure is not None:
            # Raised outside the except block so the original error (which may quote the server's
            # reply) is not attached as __context__.
            raise MailError(f"email could not be sent ({failure})")
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_email.py tests/test_mailer.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/alert_email.py api/app/mailer.py api/tests/test_alert_email.py api/tests/test_mailer.py
git commit -m "feat(api): alert email text and SMTP mailer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The check (`decide` and `run_check`)

**Files:**
- Modify: `api/app/alerts.py`
- Create: `api/tests/test_alert_check.py`

**Interfaces:**
- Consumes: `beyond`, `ARMED`, `TRIGGERED` (Task 3); `AlertDetails`, `compose` (Task 4); `Mailer`, `MailError` (Task 4); `Quote`, `QuoteCache.get(ticker, max_age)`, `QuoteError`, `QuoteProvider` (Task 1); `app.market_routes._store(conn, quote)`.
- Produces: `decide(side, state, price, limit, last_alerted_at, now, cooldown_seconds) -> str` returning `"send"`, `"rearm"` or `"none"`; `CheckResult` dataclass with int fields `sent`, `failed_emails`, `waiting_for_destination`, `quote_failures`, `rearmed`; `run_check(conn, quotes, cache, mailer, now, *, cooldown_seconds, max_emails=20) -> CheckResult` (`now` is a timezone-aware UTC `datetime`; `mailer` may be `None`).

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_check.py`:

```python
from datetime import date, datetime, timedelta, timezone

import pytest

from app.alerts import decide, run_check
from app.mailer import MailError
from app.quotes import Quote, QuoteCache, QuoteError

NOW = datetime(2026, 11, 25, 15, 42, tzinfo=timezone.utc)
HOUR = 3600


# ---------- decide: the state machine on its own ----------
@pytest.mark.parametrize(
    "side,state,price,limit,last,expected",
    [
        ("upper", "armed", 191, 190, None, "send"),
        ("upper", "armed", 190, 190, None, "send"),  # reaching it counts
        ("upper", "armed", 189, 190, None, "none"),
        ("upper", "triggered", 191, 190, None, "none"),  # already told: stay quiet while beyond
        ("upper", "triggered", 189, 190, None, "rearm"),  # back inside
        ("lower", "armed", 149, 150, None, "send"),
        ("lower", "triggered", 151, 150, None, "rearm"),
        ("upper", "armed", 191, 190, NOW - timedelta(minutes=59), "none"),  # cooldown
        ("upper", "armed", 191, 190, NOW - timedelta(minutes=61), "send"),
    ],
)
def test_decide(side, state, price, limit, last, expected):
    assert decide(side, state, price, limit, last, NOW, HOUR) == expected


# ---------- run_check with fakes ----------
class FakeQuotes:
    def __init__(self, prices, previous=186.76):
        self.prices, self.previous, self.calls = prices, previous, []

    def quote(self, ticker):
        self.calls.append(ticker)
        if ticker not in self.prices:
            raise QuoteError("no quote for this symbol")
        return Quote(ticker, self.prices[ticker], date(2026, 11, 25), self.previous)


class FakeMailer:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, body):
        if self.fail:
            raise MailError("email could not be sent (SMTPAuthenticationError)")
        self.sent.append((to, subject, body))


def add_user(conn, email, alert_email="me@example.com"):
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at, alert_email) VALUES (?, 'x', 'now', ?)",
        (email, alert_email),
    )
    conn.commit()
    return cur.lastrowid


def add_watch(conn, user_id, ticker="AAPL", upper=None, lower=None, name="Apple Inc", note=None,
              upper_state="armed", lower_state="armed", last=None):
    conn.execute(
        "INSERT INTO watchlist (user_id, ticker, name, upper_limit, lower_limit, upper_state,"
        " lower_state, last_alerted_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, ticker, name, upper, lower, upper_state, lower_state, last, note),
    )
    conn.commit()


def state(conn, ticker="AAPL", user_id=1):
    return conn.execute(
        "SELECT upper_state, lower_state, last_alerted_at FROM watchlist WHERE ticker = ? AND user_id = ?",
        (ticker, user_id),
    ).fetchone()


def check(conn, quotes, mailer, now=NOW, cache=None, **kw):
    return run_check(conn, quotes, cache or QuoteCache(0), mailer, now, cooldown_seconds=HOUR, **kw)


def test_it_emails_once_when_a_limit_is_reached_and_marks_it_triggered(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190, lower=150, note="Wait for earnings")
    mailer = FakeMailer()
    result = check(db_conn, FakeQuotes({"AAPL": 190.12}), mailer)
    assert result.sent == 1 and len(mailer.sent) == 1
    to, subject, body = mailer.sent[0]
    assert to == "me@example.com"
    assert subject == "AAPL rose above your upper limit ($190.00)"
    assert "Wait for earnings" in body and "+1.8% vs yesterday's close of $186.76" in body
    assert state(db_conn) == ("triggered", "armed", NOW.isoformat())
    # the same price on the next cycle sends nothing
    assert check(db_conn, FakeQuotes({"AAPL": 190.12}), mailer, now=NOW + timedelta(minutes=2)).sent == 0
    assert len(mailer.sent) == 1


def test_it_rearms_when_the_price_returns_and_emails_again_after_the_cooldown(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 191}), mailer)
    r = check(db_conn, FakeQuotes({"AAPL": 185}), mailer, now=NOW + timedelta(minutes=10))
    assert r.rearmed == 1 and state(db_conn)[0] == "armed"
    # crosses again inside the hour: held back by the cooldown, still armed
    r = check(db_conn, FakeQuotes({"AAPL": 192}), mailer, now=NOW + timedelta(minutes=20))
    assert r.sent == 0 and state(db_conn)[0] == "armed"
    # after the cooldown the next check sends it
    r = check(db_conn, FakeQuotes({"AAPL": 192}), mailer, now=NOW + timedelta(minutes=65))
    assert r.sent == 1 and len(mailer.sent) == 2


def test_a_lower_limit_sends_the_fell_below_email(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190, lower=150)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 149}), mailer)
    assert mailer.sent[0][1] == "AAPL fell below your lower limit ($150.00)"
    assert state(db_conn)[:2] == ("armed", "triggered")


def test_a_failed_send_leaves_the_limit_armed_so_the_next_cycle_retries(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    r = check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer(fail=True))
    assert r.failed_emails == 1 and r.sent == 0
    assert state(db_conn) == ("armed", "armed", None)
    mailer = FakeMailer()
    assert check(db_conn, FakeQuotes({"AAPL": 191}), mailer, now=NOW + timedelta(minutes=2)).sent == 1


@pytest.mark.parametrize("alert_email,use_mailer", [(None, True), ("me@example.com", False)])
def test_without_a_destination_the_alert_stays_armed_and_is_counted(db_conn, alert_email, use_mailer):
    uid = add_user(db_conn, "a@x.com", alert_email=alert_email)
    add_watch(db_conn, uid, upper=190)
    r = check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer() if use_mailer else None)
    assert r.waiting_for_destination == 1 and r.sent == 0
    assert state(db_conn)[0] == "armed"


def test_a_ticker_that_cannot_be_quoted_does_not_stop_the_others(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, "ZZZZ", upper=10)
    add_watch(db_conn, uid, "AAPL", upper=190)
    mailer = FakeMailer()
    r = check(db_conn, FakeQuotes({"AAPL": 191}), mailer)
    assert r.quote_failures == 1 and r.sent == 1
    assert state(db_conn, "ZZZZ") == ("armed", "armed", None)


def test_two_users_watching_one_ticker_cost_one_quote_and_each_gets_an_email(db_conn):
    a, b = add_user(db_conn, "a@x.com", "a@example.com"), add_user(db_conn, "b@x.com", "b@example.com")
    add_watch(db_conn, a, upper=190)
    add_watch(db_conn, b, upper=180)
    quotes, mailer = FakeQuotes({"AAPL": 191}), FakeMailer()
    r = check(db_conn, quotes, mailer)
    assert quotes.calls == ["AAPL"] and r.sent == 2
    assert sorted(m[0] for m in mailer.sent) == ["a@example.com", "b@example.com"]


def test_ticker_with_no_limits_is_never_quoted(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=None, lower=None)
    quotes = FakeQuotes({"AAPL": 1})
    check(db_conn, quotes, FakeMailer())
    assert quotes.calls == []


def test_it_stores_the_quote_as_a_shared_market_price(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer())
    assert db_conn.execute(
        "SELECT user_id, price, source FROM prices WHERE ticker = 'AAPL'"
    ).fetchall() == [(None, 191.0, "market")]


def test_a_fresh_cached_quote_is_used_but_an_old_one_is_not(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    now = [0.0]
    cache = QuoteCache(120, clock=lambda: now[0])
    cache.put(Quote("AAPL", 191.0, date(2026, 11, 25)))
    quotes = FakeQuotes({"AAPL": 195})
    now[0] = 30
    check(db_conn, quotes, FakeMailer(), cache=cache)
    assert quotes.calls == []  # 30 s old: used
    now[0] = 90
    check(db_conn, quotes, FakeMailer(), now=NOW + timedelta(hours=2), cache=cache)
    assert quotes.calls == ["AAPL"]  # 90 s old: too stale for the checker


def test_at_most_max_emails_go_out_in_one_cycle(db_conn):
    uid = add_user(db_conn, "a@x.com")
    for t in ("AAA", "BBB", "CCC"):
        add_watch(db_conn, uid, t, upper=1)
    mailer = FakeMailer()
    r = check(db_conn, FakeQuotes({"AAA": 2, "BBB": 2, "CCC": 2}), mailer, max_emails=2)
    assert r.sent == 2
    assert check(db_conn, FakeQuotes({"AAA": 2, "BBB": 2, "CCC": 2}), mailer, max_emails=2).sent == 1


def test_a_last_trade_on_another_day_is_mentioned_in_the_email(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    later = NOW + timedelta(days=2)  # checked two days after the last trade (a weekend)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 191}), mailer, now=later)
    assert "last trade 2026-11-25" in mailer.sent[0][2]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_check.py`
Expected: FAIL (`cannot import name 'decide'`).

- [ ] **Step 3: Implement**

Append to `api/app/alerts.py` (and add these imports at the top of the file, above the existing constants):

```python
import logging
import time
from dataclasses import dataclass
from datetime import datetime

from app.alert_email import AlertDetails, compose
from app.db import rows
from app.mailer import MailError, Mailer
from app.market_routes import _store as store_market_price
from app.quotes import Quote, QuoteCache, QuoteError, QuoteProvider

log = logging.getLogger("freeman.alerts")

MAX_TICKERS = 50  # Finnhub's free tier allows 60 calls a minute
QUOTE_MAX_AGE = 60.0  # a cached quote older than this is not trusted for an alert
BUDGET_SECONDS = 90.0  # stop asking the provider after this long in one cycle
```

then append:

```python
def decide(
    side: str,
    state: str,
    price: float,
    limit: float,
    last_alerted_at: datetime | None,
    now: datetime,
    cooldown_seconds: int,
) -> str:
    """What to do with one limit this cycle: "send" an email, "rearm" it, or do "none".

    Fire once: an armed limit emails when reached; a triggered one stays quiet while the price is
    beyond it and re-arms when the price is back inside. The cooldown stops a price flickering
    around a limit from emailing every cycle.
    """
    is_beyond = beyond(side, price, limit)
    if state == TRIGGERED:
        return "none" if is_beyond else "rearm"
    if not is_beyond:
        return "none"
    if last_alerted_at is not None and (now - last_alerted_at).total_seconds() < cooldown_seconds:
        return "none"
    return "send"


@dataclass
class CheckResult:
    sent: int = 0
    failed_emails: int = 0
    waiting_for_destination: int = 0  # reached, but no address (or no mail server) to send to
    quote_failures: int = 0
    rearmed: int = 0


def _details(item: dict, side: str, quote: Quote, now: datetime, cooldown_seconds: int) -> AlertDetails:
    last_trade = quote.as_of.isoformat()
    return AlertDetails(
        ticker=item["ticker"],
        name=item["name"],
        side=side,
        price=quote.price,
        limit=item[f"{side}_limit"],
        upper_limit=item["upper_limit"],
        lower_limit=item["lower_limit"],
        previous_close=quote.previous_close,
        note=item["note"],
        checked_at=now.strftime("%Y-%m-%d %H:%M UTC"),
        last_trade_day=None if last_trade == now.date().isoformat() else last_trade,
        cooldown_seconds=cooldown_seconds,
    )


def run_check(
    conn,
    quotes: QuoteProvider,
    cache: QuoteCache,
    mailer: Mailer | None,
    now: datetime,
    *,
    cooldown_seconds: int,
    max_emails: int = 20,
) -> CheckResult:
    """One pass over every watchlist limit, for every user. `now` must be timezone-aware UTC.

    Quotes each distinct ticker once, saves the price as today's shared market price (so the app is
    fresh too), then applies `decide` to each limit. A failed quote or email never loses an alert:
    the limit simply stays armed and the next cycle tries again.
    """
    result = CheckResult()
    items = rows(
        conn.execute(
            "SELECT w.*, u.alert_email FROM watchlist w JOIN users u ON u.id = w.user_id"
            " WHERE w.upper_limit IS NOT NULL OR w.lower_limit IS NOT NULL ORDER BY w.ticker, w.id"
        )
    )

    fetched: dict[str, Quote] = {}
    started = time.monotonic()
    for ticker in list(dict.fromkeys(i["ticker"] for i in items))[:MAX_TICKERS]:
        quote = cache.get(ticker, max_age=QUOTE_MAX_AGE)
        if quote is None:
            if time.monotonic() - started > BUDGET_SECONDS:
                result.quote_failures += 1
                continue
            try:
                quote = quotes.quote(ticker)
            except QuoteError as e:
                log.warning("price alerts: no quote for %s (%s)", ticker, e)
                result.quote_failures += 1
                continue
            cache.put(quote)
            store_market_price(conn, quote)
        fetched[ticker] = quote

    emails = 0
    for item in items:
        quote = fetched.get(item["ticker"])
        if quote is None:
            continue
        last = datetime.fromisoformat(item["last_alerted_at"]) if item["last_alerted_at"] else None
        for side in ("upper", "lower"):
            limit = item[f"{side}_limit"]
            if limit is None:
                continue
            action = decide(side, item[f"{side}_state"], quote.price, limit, last, now, cooldown_seconds)
            if action == "rearm":
                conn.execute(f"UPDATE watchlist SET {side}_state = 'armed' WHERE id = ?", (item["id"],))
                result.rearmed += 1
            elif action == "send":
                if not item["alert_email"] or mailer is None:
                    result.waiting_for_destination += 1
                    continue
                if emails >= max_emails:
                    continue  # stays armed; the next cycle sends it
                subject, body = compose(_details(item, side, quote, now, cooldown_seconds))
                try:
                    mailer.send(item["alert_email"], subject, body)
                except MailError as e:
                    log.warning("price alerts: %s", e)
                    result.failed_emails += 1
                    continue
                emails += 1
                result.sent += 1
                conn.execute(
                    f"UPDATE watchlist SET {side}_state = 'triggered', last_alerted_at = ? WHERE id = ?",
                    (now.isoformat(), item["id"]),
                )
    conn.commit()
    return result
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_check.py tests/test_alert_state.py`
Expected: PASS.

- [ ] **Step 5: Run the whole API suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/app/alerts.py api/tests/test_alert_check.py
git commit -m "feat(api): price alert check with fire-once, re-arm and cooldown

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Alert settings and test-email endpoints

**Files:**
- Create: `api/app/alert_routes.py`
- Modify: `api/app/main.py` (include the router)
- Create: `api/tests/test_alert_routes.py`

**Interfaces:**
- Consumes: `Mailer`, `MailError`, `SmtpMailer` (Task 4); `Settings.email_configured`, `Settings.email_sender` (Task 1); `users.alert_email` (Task 2).
- Produces: `GET /alerts/settings -> {"email": str | None, "email_configured": bool}`, `PUT /alerts/settings` (body `{"email": str | null}`, same response), `POST /alerts/test -> {"sent_to": str}` (503 server not set up, 409 no saved address, 502 send failed); dependency `app.alert_routes.get_mailer`.

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_routes.py`:

```python
import pytest

from app import alert_routes, main
from app.config import get_settings
from app.mailer import MailError
from tests.conftest import make_settings


class FakeMailer:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, body):
        if self.fail:
            raise MailError("email could not be sent (SMTPAuthenticationError)")
        self.sent.append((to, subject, body))


def with_mail_configured():
    main.app.dependency_overrides[get_settings] = lambda: make_settings(
        smtp_user="me@gmail.com", smtp_password="app-password"
    )


def test_settings_start_empty_and_report_whether_the_server_can_send(client):
    assert client.get("/alerts/settings").json() == {"email": None, "email_configured": False}
    with_mail_configured()
    assert client.get("/alerts/settings").json()["email_configured"] is True


def test_the_address_can_be_saved_changed_and_cleared(client):
    r = client.put("/alerts/settings", json={"email": "  Me@Example.com "})
    assert r.status_code == 200 and r.json()["email"] == "Me@Example.com"
    assert client.get("/alerts/settings").json()["email"] == "Me@Example.com"
    assert client.put("/alerts/settings", json={"email": ""}).json()["email"] is None
    client.put("/alerts/settings", json={"email": "a@b.co"})
    assert client.put("/alerts/settings", json={"email": None}).json()["email"] is None


@pytest.mark.parametrize("bad", ["not-an-email", "a@b", "a b@c.com", "a@b.com\r\nBcc: x@y.com", "x" * 250 + "@a.com"])
def test_a_bad_address_is_rejected(client, bad):
    assert client.put("/alerts/settings", json={"email": bad}).status_code == 422


def test_each_account_has_its_own_address(client):
    bob = client.new_user("bob@example.com")
    client.put("/alerts/settings", json={"email": "alice@mail.com"})
    assert bob.get("/alerts/settings").json()["email"] is None
    bob.put("/alerts/settings", json={"email": "bob@mail.com"})
    assert client.get("/alerts/settings").json()["email"] == "alice@mail.com"


def test_the_endpoints_need_a_signed_in_user(anon):
    assert anon.get("/alerts/settings").status_code == 401
    assert anon.put("/alerts/settings", json={"email": None}).status_code == 401
    assert anon.post("/alerts/test").status_code == 401


def test_a_test_email_says_so_when_the_server_has_no_mail_settings(client):
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 503 and "SMTP_USER" in r.json()["detail"]


def test_a_test_email_needs_a_saved_address(client):
    with_mail_configured()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: FakeMailer()
    r = client.post("/alerts/test")
    assert r.status_code == 409


def test_a_test_email_is_sent_to_the_saved_address(client):
    with_mail_configured()
    mailer = FakeMailer()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: mailer
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 200 and r.json() == {"sent_to": "me@mail.com"}
    assert mailer.sent[0][0] == "me@mail.com" and "test" in mailer.sent[0][1].lower()


def test_a_failed_test_email_is_a_502_with_a_safe_message(client):
    with_mail_configured()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: FakeMailer(fail=True)
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 502
    assert "SMTPAuthenticationError" in r.json()["detail"] and "app-password" not in r.text
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_routes.py`
Expected: FAIL (module missing / 404).

- [ ] **Step 3: Implement**

`api/app/alert_routes.py`:

```python
"""Where price alerts are sent, and a way to check the email setup works."""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.auth import current_user_id
from app.config import Settings, get_settings
from app.db import get_conn, one
from app.mailer import MailError, Mailer, SmtpMailer

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Deliberately simple: one @, no spaces or control characters, a dot in the domain. A typo is
# caught by the test email, not by a clever regex.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AlertSettingsIn(BaseModel):
    email: Optional[str] = None  # empty or null turns alerts off for this account

    @field_validator("email")
    @classmethod
    def _valid(cls, v):
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if len(v) > 254 or not _EMAIL.match(v):
            raise ValueError("Enter a valid email address.")
        return v


def get_mailer(settings: Settings = Depends(get_settings)) -> Mailer:
    if not settings.email_configured:
        raise HTTPException(
            503, "Email is not set up on the server: set SMTP_USER and SMTP_PASSWORD in api/.env."
        )
    return SmtpMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        password=settings.smtp_password,
        sender=settings.email_sender,
    )


def _current(conn, uid: int, settings: Settings) -> dict:
    row = one(conn.execute("SELECT alert_email FROM users WHERE id = ?", (uid,)))
    return {
        "email": row["alert_email"] if row else None,
        "email_configured": settings.email_configured,
    }


@router.get("/settings")
def read_settings(
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
):
    return _current(conn, uid, settings)


@router.put("/settings")
def save_settings(
    body: AlertSettingsIn,
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
):
    conn.execute("UPDATE users SET alert_email = ? WHERE id = ?", (body.email, uid))
    conn.commit()
    return _current(conn, uid, settings)


@router.post("/test")
def send_test_email(
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    mailer: Mailer = Depends(get_mailer),
):
    row = one(conn.execute("SELECT alert_email FROM users WHERE id = ?", (uid,)))
    email = row["alert_email"] if row else None
    if not email:
        raise HTTPException(409, "Save an alert email address first.")
    try:
        mailer.send(
            email,
            "Freeman test email",
            "This is a test from Freeman.\n\nPrice alerts for your watchlist will be sent to this address.",
        )
    except MailError as e:
        raise HTTPException(502, str(e))
    return {"sent_to": email}
```

In `api/app/main.py` add `from app.alert_routes import router as alert_router` next to the other router imports and `app.include_router(alert_router)` after `app.include_router(market_router)`.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/app/alert_routes.py api/app/main.py api/tests/test_alert_routes.py
git commit -m "feat(api): alert email settings and test-email endpoints

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The background loop and server wiring

**Files:**
- Create: `api/app/alert_loop.py`
- Modify: `api/app/main.py` (lifespan, imports)
- Modify: `api/tests/conftest.py` (keep tests off real mail settings)
- Create: `api/tests/test_alert_loop.py`

**Interfaces:**
- Consumes: `run_check`, `CheckResult` (Task 5); `SmtpMailer` (Task 4); `get_quote_cache` (`app.market_routes`); `FinnhubQuotes`.
- Produces: `start_alert_loop(settings: Settings, open_conn: Callable[[], Any], stop: threading.Event) -> threading.Thread | None` (returns `None` and logs one line when `finnhub_api_key` or the SMTP settings are missing).

- [ ] **Step 1: Write the failing tests**

`api/tests/test_alert_loop.py`:

```python
import threading

import pytest
from fastapi.testclient import TestClient

from app import alert_loop, main
from app.alerts import CheckResult
from app.config import get_settings
from app.db import connect, get_conn, init_schema
from tests.conftest import make_settings


def configured(**over):
    return make_settings(
        finnhub_api_key="fh", smtp_user="me@gmail.com", smtp_password="pw", alert_check_seconds=1, **over
    )


def test_it_does_not_start_without_a_market_data_key():
    stop = threading.Event()
    assert alert_loop.start_alert_loop(
        make_settings(smtp_user="me@gmail.com", smtp_password="pw"), lambda: None, stop
    ) is None


def test_it_does_not_start_without_mail_settings():
    stop = threading.Event()
    assert alert_loop.start_alert_loop(make_settings(finnhub_api_key="fh"), lambda: None, stop) is None


def test_it_runs_a_check_and_stops_when_asked(monkeypatch):
    called = threading.Event()

    class Conn:
        closed = False

        def close(self):
            Conn.closed = True

    def fake_check(conn, quotes, cache, mailer, now, **kw):
        called.set()
        return CheckResult()

    monkeypatch.setattr(alert_loop, "run_check", fake_check)
    stop = threading.Event()
    t = alert_loop.start_alert_loop(configured(), Conn, stop)
    assert t is not None and t.daemon
    assert called.wait(5)
    stop.set()
    t.join(5)
    assert not t.is_alive() and Conn.closed


def test_an_error_in_one_check_does_not_end_the_loop(monkeypatch):
    calls = []
    second = threading.Event()

    def flaky(conn, quotes, cache, mailer, now, **kw):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        second.set()
        return CheckResult()

    monkeypatch.setattr(alert_loop, "run_check", flaky)
    stop = threading.Event()
    t = alert_loop.start_alert_loop(configured(), lambda: type("C", (), {"close": lambda s: None})(), stop)
    assert second.wait(5)  # it kept going after the first check raised
    stop.set()
    t.join(5)


def test_the_server_starts_the_loop_with_the_app_and_stops_it_on_shutdown(monkeypatch, tmp_path):
    db = str(tmp_path / "t.db")
    init_schema(connect(db))
    seen = {}

    def fake_start(settings, open_conn, stop):
        seen["stop"] = stop
        return None

    monkeypatch.setattr(main, "start_alert_loop", fake_start)

    def _conn():
        yield connect(db)

    main.app.dependency_overrides[get_conn] = _conn
    main.app.dependency_overrides[get_settings] = lambda: make_settings()
    try:
        with TestClient(main.app):
            assert not seen["stop"].is_set()
        assert seen["stop"].is_set()
    finally:
        main.app.dependency_overrides.clear()
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python -m pytest -q tests/test_alert_loop.py`
Expected: FAIL (`app.alert_loop` missing).

- [ ] **Step 3: Implement**

`api/app/alert_loop.py`:

```python
"""Runs the price alert check in the background for as long as the server is up."""

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from app.alerts import run_check
from app.config import Settings
from app.mailer import SmtpMailer
from app.market_routes import get_quote_cache
from app.quotes import FinnhubQuotes

log = logging.getLogger("freeman.alerts")


def start_alert_loop(
    settings: Settings, open_conn: Callable[[], Any], stop: threading.Event
) -> threading.Thread | None:
    """Starts the checker thread, or returns None (after one log line) when alerts cannot work.

    Each cycle opens its own database connection and closes it, so the thread never shares a
    connection with request handlers. Setting `stop` ends the loop within one wait.
    """
    if not settings.finnhub_api_key:
        log.info("price alerts are off: FINNHUB_API_KEY is not set")
        return None
    if not settings.email_configured:
        log.info("price alerts are off: SMTP_USER and SMTP_PASSWORD are not set")
        return None

    quotes = FinnhubQuotes(settings.finnhub_api_key, timeout=settings.quote_timeout_seconds)
    mailer = SmtpMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        password=settings.smtp_password,
        sender=settings.email_sender,
    )
    cache = get_quote_cache(settings)

    def loop() -> None:
        log.info("price alerts are on: checking every %s seconds", settings.alert_check_seconds)
        while not stop.is_set():
            try:
                conn = open_conn()
                try:
                    result = run_check(
                        conn, quotes, cache, mailer, datetime.now(timezone.utc),
                        cooldown_seconds=settings.alert_cooldown_seconds,
                    )
                finally:
                    close = getattr(conn, "close", None)
                    if close:
                        close()
                if result.sent or result.failed_emails:
                    log.info("price alerts: %s sent, %s failed", result.sent, result.failed_emails)
            except Exception:  # one bad cycle must never end the checker
                log.exception("price alert check failed")
            stop.wait(settings.alert_check_seconds)

    thread = threading.Thread(target=loop, name="price-alerts", daemon=True)
    thread.start()
    return thread
```

In `api/app/main.py` add to the imports: `from app.alert_loop import start_alert_loop` and change `from app.db import get_conn, init_schema, one, rows` to `from app.db import connect, get_conn, init_schema, one, rows`; then replace `lifespan` with:

```python
@asynccontextmanager
async def lifespan(_app: FastAPI):
    gen = _app.dependency_overrides.get(get_conn, get_conn)()
    conn = next(gen)
    try:
        init_schema(conn)
    finally:
        gen.close()

    # The price alert checker lives as long as the server. It starts only when market data and
    # email are configured (see start_alert_loop).
    settings = _app.dependency_overrides.get(get_settings, get_settings)()
    stop = threading.Event()
    start_alert_loop(
        settings, lambda: connect(settings.turso_database_url, settings.turso_auth_token), stop
    )
    yield
    stop.set()
```

In `api/tests/conftest.py`, extend the block that pins the test secret so it also reads:

```python
os.environ["JWT_SECRET"] = SECRET
# A developer's real mail settings must never make the test suite start the alert checker.
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
```

- [ ] **Step 4: Run to verify it passes, then run the whole suite**

Run: `.venv/Scripts/python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/app/alert_loop.py api/app/main.py api/tests/conftest.py api/tests/test_alert_loop.py
git commit -m "feat(api): run the price alert check in the background with the server

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: App types, API calls, fixtures and the limits form

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/test-utils/fixtures.ts:45-56`
- Modify: `src/app/add-watch.tsx`
- Modify: `src/__tests__/add-watch.test.tsx`
- Modify: `src/lib/api-requests.test.ts` (append)

**Interfaces:**
- Produces: `type LimitState = 'armed' | 'triggered'`; `WatchItem` gains `upper_limit: number | null`, `lower_limit: number | null`, `upper_state: LimitState`, `lower_state: LimitState` and loses `target_price`; `NewWatch` has `upper_limit?`, `lower_limit?`; `type AlertSettings = { email: string | null; email_configured: boolean }`; `api.getAlertSettings(): Promise<AlertSettings>`, `api.saveAlertSettings(email: string | null): Promise<AlertSettings>`, `api.sendTestAlert(): Promise<{ sent_to: string }>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/api-requests.test.ts`:

```ts
describe('alerts', () => {
  test('reads the alert settings', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockReturnValue(json(200, { email: null, email_configured: false }));
    expect(await api.getAlertSettings()).toEqual({ email: null, email_configured: false });
    expect(lastCall(spy).url).toBe('http://api.test/alerts/settings');
  });

  test('saves the address with PUT, and null clears it', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockReturnValue(json(200, { email: 'me@mail.com', email_configured: true }));
    await api.saveAlertSettings('me@mail.com');
    expect(lastCall(spy).init.method).toBe('PUT');
    expect(lastCall(spy).init.body).toBe(JSON.stringify({ email: 'me@mail.com' }));
    await api.saveAlertSettings(null);
    expect(lastCall(spy).init.body).toBe(JSON.stringify({ email: null }));
  });

  test('sends a test email with POST', async () => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, { sent_to: 'me@mail.com' }));
    expect(await api.sendTestAlert()).toEqual({ sent_to: 'me@mail.com' });
    expect(lastCall(spy).url).toBe('http://api.test/alerts/test');
    expect(lastCall(spy).init.method).toBe('POST');
  });
});
```

Replace the tests in `src/__tests__/add-watch.test.tsx` that use the old field. The first two tests become:

```tsx
test('saves a normalized item and closes', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), ' nvda ');
  await fireEvent.changeText(screen.getByLabelText('Name (optional)'), ' NVIDIA ');
  await fireEvent.changeText(screen.getByLabelText('Alert above (optional)'), '500,5');
  await fireEvent.changeText(screen.getByLabelText('Alert below (optional)'), '350');
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(addWatch).toHaveBeenCalledWith({
    ticker: 'NVDA',
    name: 'NVIDIA',
    upper_limit: 500.5,
    lower_limit: 350,
    note: null,
  });
});

test('blank optional fields are sent as null, not empty strings or zero', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'aapl');
  await fireEvent.press(save());
  await waitFor(() => expect(addWatch).toHaveBeenCalled());
  expect(addWatch).toHaveBeenCalledWith({
    ticker: 'AAPL',
    name: null,
    upper_limit: null,
    lower_limit: null,
    note: null,
  });
});
```

and the test `'rejects a negative or non-numeric target'` is replaced with:

```tsx
test.each([
  ['Alert above (optional)', '-5'],
  ['Alert above (optional)', 'abc'],
  ['Alert above (optional)', '0'],
  ['Alert below (optional)', '-5'],
  ['Alert below (optional)', 'abc'],
])('rejects %p = %p without a request', async (label, value) => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
  await fireEvent.changeText(screen.getByLabelText(label), value);
  await fireEvent.press(save());
  expect(screen.getByText('Enter a price above 0')).toBeTruthy();
  expect(addWatch).not.toHaveBeenCalled();
});

test('the lower limit must be below the upper limit', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
  await fireEvent.changeText(screen.getByLabelText('Alert above (optional)'), '100');
  await fireEvent.changeText(screen.getByLabelText('Alert below (optional)'), '100');
  await fireEvent.press(save());
  expect(screen.getByText('Must be below the upper limit')).toBeTruthy();
  expect(addWatch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run (repo root): `npx jest src/__tests__/add-watch.test.tsx src/lib/api-requests.test.ts`
Expected: FAIL (`api.getAlertSettings is not a function`, labels not found).

- [ ] **Step 3: Implement**

In `src/types.ts` replace the `WatchItem` and `NewWatch` types with:

```ts
/** 'triggered' means the price is past the limit and no more emails come until it crosses back. */
export type LimitState = 'armed' | 'triggered';

export type WatchItem = {
  id: number;
  ticker: string;
  name: string | null;
  /** Email me when the price reaches this (at or above). */
  upper_limit: number | null;
  /** Email me when the price falls to this (at or below). */
  lower_limit: number | null;
  upper_state: LimitState;
  lower_state: LimitState;
  note: string | null;
  /** Latest price mark, if any. */
  price: number | null;
  price_as_of: string | null;
  price_kind: PriceKind | null;
  /** (upper limit - price) / price * 100; null without both an upper limit and a price. */
  pct_to_target: number | null;
};

export type NewWatch = {
  ticker: string;
  name?: string | null;
  upper_limit?: number | null;
  lower_limit?: number | null;
  note?: string | null;
};

export type AlertSettings = { email: string | null; email_configured: boolean };
```

In `src/lib/api.ts` add `AlertSettings` to the `import type { ... } from '@/types'` list (keep it alphabetical), update the comment on `addWatch` to `// POST upserts by ticker, so adding an existing ticker updates its limits and note.`, and add after `deleteWatch`:

```ts
  getAlertSettings: () => request<AlertSettings>('/alerts/settings'),
  // null clears the address, which turns alerts off for this account.
  saveAlertSettings: (email: string | null) =>
    request<AlertSettings>('/alerts/settings', { method: 'PUT', body: JSON.stringify({ email }) }),
  sendTestAlert: () => request<{ sent_to: string }>('/alerts/test', { method: 'POST' }),
```

In `src/test-utils/fixtures.ts` replace `target_price: 200,` in `watchItem` with:

```ts
  upper_limit: 200,
  lower_limit: null,
  upper_state: 'armed',
  lower_state: 'armed',
```

Replace `src/app/add-watch.tsx` with:

```tsx
import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import { ScrollScreen } from '@/components/layout/scroll-screen';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { useAddWatch } from '@/hooks/use-watchlist';
import { haptic } from '@/lib/haptics';

type Errors = Partial<Record<'ticker' | 'upper' | 'lower', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));
const blank = (s: string) => s.trim() === '';

export default function AddWatchScreen() {
  const router = useRouter();
  const add = useAddWatch();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/watchlist'));

  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [upper, setUpper] = useState('');
  const [lower, setLower] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker, e.g. NVDA';
    if (!blank(upper) && !(num(upper) > 0)) e.upper = 'Enter a price above 0';
    if (!blank(lower) && !(num(lower) > 0)) e.lower = 'Enter a price above 0';
    if (!e.upper && !e.lower && !blank(upper) && !blank(lower) && num(lower) >= num(upper)) {
      e.lower = 'Must be below the upper limit';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      haptic('warning');
      return;
    }
    add.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        name: name.trim() || null,
        upper_limit: blank(upper) ? null : num(upper),
        lower_limit: blank(lower) ? null : num(lower),
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          haptic('success');
          close();
        },
        onError: () => haptic('error'),
      },
    );
  }

  return (
    <ScrollScreen avoidKeyboard>
      <TextField
        label="Ticker"
        error={errors.ticker}
        value={ticker}
        onChangeText={setTicker}
        placeholder="NVDA"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <TextField label="Name (optional)" value={name} onChangeText={setName} placeholder="NVIDIA" />
      <TextField
        label="Alert above (optional)"
        error={errors.upper}
        value={upper}
        onChangeText={setUpper}
        placeholder="500"
        keyboardType="decimal-pad"
      />
      <TextField
        label="Alert below (optional)"
        error={errors.lower}
        value={lower}
        onChangeText={setLower}
        placeholder="350"
        keyboardType="decimal-pad"
      />
      <ThemedText type="small" themeColor="textSecondary">
        You get an email when the price reaches either limit. Set where to send it under Email
        alerts on the Watchlist.
      </ThemedText>
      <TextField
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Why are you watching it?"
      />
      <ThemedText type="small" themeColor="textSecondary">
        Adding a ticker that is already on the list updates its limits and note.
      </ThemedText>

      {add.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {add.error.message}
        </ThemedText>
      ) : null}

      <Button title="Save" onPress={submit} loading={add.isPending} />
      <Button title="Cancel" variant="secondary" onPress={close} />
    </ScrollScreen>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/add-watch.test.tsx src/lib/api-requests.test.ts`
Expected: PASS. (`watch-row.tsx` and the watchlist screen test still reference the old field until Task 9; do not run `tsc` yet.)

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/app/add-watch.tsx src/types.ts src/lib/api.ts src/lib/api-requests.test.ts src/__tests__/add-watch.test.tsx src/test-utils/fixtures.ts
git add src
git commit -m "feat: upper and lower alert limits in the app types, API calls and add-watch form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Watch row text

**Files:**
- Modify: `src/components/rows/watch-row.tsx`
- Modify: `src/__tests__/watchlist-screen.test.tsx`
- Create: `src/components/rows/watch-row.test.tsx`

**Interfaces:**
- Consumes: `WatchItem` with `upper_limit`, `lower_limit`, `upper_state`, `lower_state`, `price`, `pct_to_target` (Task 8); `formatCurrency`, `formatPercent` from `@/lib/format`.
- Produces: the row shows one line per limit: `Alert above $X · +N% to go`, `Alert below $X · -N% to go`, `... · reached`, `... · paused until the price crosses back`, `... · log a price to compare`, or `No alerts set`.

- [ ] **Step 1: Write the failing tests**

`src/components/rows/watch-row.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { WatchRow } from '@/components/rows/watch-row';
import { watchItem } from '@/test-utils/fixtures';

const show = (over = {}) =>
  render(<WatchRow item={watchItem(over)} onPress={jest.fn()} onLongPress={jest.fn()} />);

test('an armed upper limit shows how far the price has to go', async () => {
  await show({ price: 180, upper_limit: 200, pct_to_target: 11.11 });
  expect(screen.getByText('Alert above $200.00 · +11.11% to go')).toBeTruthy();
});

test('an armed lower limit shows how far the price could fall', async () => {
  await show({ price: 200, upper_limit: null, lower_limit: 150, pct_to_target: null });
  expect(screen.getByText('Alert below $150.00 · -25.00% to go')).toBeTruthy();
});

test('both limits get a line each', async () => {
  await show({ price: 180, upper_limit: 200, lower_limit: 150, pct_to_target: 11.11 });
  expect(screen.getByText(/Alert above \$200\.00/)).toBeTruthy();
  expect(screen.getByText(/Alert below \$150\.00/)).toBeTruthy();
});

test('a limit that was reached and emailed says it is paused', async () => {
  await show({ price: 210, upper_limit: 200, upper_state: 'triggered', pct_to_target: -4.76 });
  expect(
    screen.getByText('Alert above $200.00 · paused until the price crosses back'),
  ).toBeTruthy();
});

test('a limit that is reached but still armed (email not sent yet) says reached', async () => {
  await show({ price: 210, upper_limit: 200, upper_state: 'armed', pct_to_target: -4.76 });
  expect(screen.getByText('Alert above $200.00 · reached')).toBeTruthy();
});

test('without a price it asks for one', async () => {
  await show({ price: null, price_kind: null, price_as_of: null, pct_to_target: null });
  expect(screen.getByText('Alert above $200.00 · log a price to compare')).toBeTruthy();
});

test('an item with no limits says so', async () => {
  await show({ upper_limit: null, lower_limit: null, pct_to_target: null });
  expect(screen.getByText('No alerts set')).toBeTruthy();
});
```

In `src/__tests__/watchlist-screen.test.tsx` replace the first test with:

```tsx
test('lists watched tickers with their alert status and last price', async () => {
  listWatchlist.mockResolvedValue([
    watchItem({ id: 1, ticker: 'AAPL', price: 180, upper_limit: 200, pct_to_target: 11.11 }),
    watchItem({
      id: 2,
      ticker: 'MSFT',
      name: 'Microsoft',
      price: 410,
      upper_limit: 400,
      upper_state: 'triggered',
      pct_to_target: -2.4,
    }),
    watchItem({
      id: 3,
      ticker: 'TSLA',
      name: null,
      price: null,
      price_kind: null,
      price_as_of: null,
      upper_limit: null,
      pct_to_target: null,
    }),
  ]);
  await renderWithClient(<WatchlistScreen />);
  expect(await screen.findByText('Alert above $200.00 · +11.11% to go')).toBeTruthy();
  expect(screen.getByText(/Alert above \$400\.00 · paused/)).toBeTruthy();
  expect(screen.getByText('No alerts set')).toBeTruthy();
  expect(screen.getByText('No price yet')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/components/rows/watch-row.test.tsx src/__tests__/watchlist-screen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/components/rows/watch-row.tsx` replace the `targetStatus` function (and its doc comment) with:

```tsx
const PAUSED = 'paused until the price crosses back';

/** One line about the upper limit, in words (never color alone), or null when there is none. */
function upperLine(item: WatchItem): string | null {
  const { upper_limit: limit, upper_state: state, price, pct_to_target: pct } = item;
  if (limit === null) return null;
  const head = `Alert above ${formatCurrency(limit)}`;
  if (state === 'triggered') return `${head} · ${PAUSED}`;
  if (price === null) return `${head} · log a price to compare`;
  if (price >= limit) return `${head} · reached`;
  return `${head} · ${formatPercent(pct ?? 0)} to go`;
}

/** The same for the lower limit; how far the price could fall before it is reached. */
function lowerLine(item: WatchItem): string | null {
  const { lower_limit: limit, lower_state: state, price } = item;
  if (limit === null) return null;
  const head = `Alert below ${formatCurrency(limit)}`;
  if (state === 'triggered') return `${head} · ${PAUSED}`;
  if (price === null) return `${head} · log a price to compare`;
  if (price <= limit) return `${head} · reached`;
  return `${head} · ${formatPercent(-((price - limit) / price) * 100)} to go`;
}

function limitLines(item: WatchItem): string[] {
  const lines = [upperLine(item), lowerLine(item)].filter((l): l is string => l !== null);
  return lines.length > 0 ? lines : ['No alerts set'];
}
```

Delete the line `const status = targetStatus(item);` at the top of the component, and replace the `ThemedText` block that rendered `status` (the one with `themeColor={status.color ?? 'textSecondary'}` including the `✓` line) with:

```tsx
            {limitLines(item).map((line) => (
              <ThemedText key={line} type="small" themeColor="textSecondary">
                {line}
              </ThemedText>
            ))}
```

- [ ] **Step 4: Run to verify it passes, then typecheck**

Run: `npx jest src/components/rows src/__tests__/watchlist-screen.test.tsx` then `npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/components/rows src/__tests__/watchlist-screen.test.tsx
git add src
git commit -m "feat: show each alert limit and its status on the watchlist row

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The Email alerts screen and its entry point

**Files:**
- Create: `src/hooks/use-alert-settings.ts`
- Create: `src/app/alert-settings.tsx`
- Create: `src/__tests__/alert-settings.test.tsx`
- Modify: `src/app/_layout.tsx` (register the screen)
- Modify: `src/app/(tabs)/watchlist.tsx` (button) and its test

**Interfaces:**
- Consumes: `api.getAlertSettings`, `api.saveAlertSettings`, `api.sendTestAlert`, `AlertSettings` (Task 8).
- Produces: `alertSettingsKey = ['alert-settings']`; `useAlertSettings()`, `useSaveAlertSettings()` (mutation taking `string | null`), `useSendTestEmail()` (mutation taking nothing); route `/alert-settings`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/alert-settings.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AlertSettingsScreen from '@/app/alert-settings';
import { api } from '@/lib/api';
import { renderWithClient } from '@/test-utils/render';

jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: { getAlertSettings: jest.fn(), saveAlertSettings: jest.fn(), sendTestAlert: jest.fn() },
  };
});

const getSettings = api.getAlertSettings as jest.Mock;
const saveSettings = api.saveAlertSettings as jest.Mock;
const sendTest = api.sendTestAlert as jest.Mock;
const field = () => screen.getByLabelText('Send alerts to');

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ email: 'me@mail.com', email_configured: true });
  saveSettings.mockImplementation(async (email: string | null) => ({
    email,
    email_configured: true,
  }));
  sendTest.mockResolvedValue({ sent_to: 'me@mail.com' });
});

test('shows the saved address and that the server can send email', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  expect(screen.getByText('The server can send email.')).toBeTruthy();
});

test('says plainly when the server has no email settings, and disables the test button', async () => {
  getSettings.mockResolvedValue({ email: 'me@mail.com', email_configured: false });
  await renderWithClient(<AlertSettingsScreen />);
  expect(await screen.findByText(/not set up to send email/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send test email' }).props.accessibilityState.disabled).toBe(
    true,
  );
});

test('saves a trimmed address', async () => {
  getSettings.mockResolvedValue({ email: null, email_configured: true });
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(getSettings).toHaveBeenCalled());
  await fireEvent.changeText(field(), '  new@mail.com ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('new@mail.com'));
});

test('an empty address turns alerts off', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), '');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(null));
});

test('rejects an address that is not an email without a request', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), 'not-an-email');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Enter a valid email address')).toBeTruthy();
  expect(saveSettings).not.toHaveBeenCalled();
});

test('the test email goes to the saved address and the result is shown', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.press(screen.getByRole('button', { name: 'Send test email' }));
  expect(await screen.findByText(/Sent to me@mail\.com/)).toBeTruthy();
  expect(sendTest).toHaveBeenCalledTimes(1);
});

test('a failed test email shows the reason', async () => {
  sendTest.mockRejectedValue(new Error('email could not be sent (SMTPAuthenticationError)'));
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.press(screen.getByRole('button', { name: 'Send test email' }));
  expect(await screen.findByText(/SMTPAuthenticationError/)).toBeTruthy();
});

test('the test button waits for unsaved changes to be saved first', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), 'other@mail.com');
  expect(screen.getByRole('button', { name: 'Send test email' }).props.accessibilityState.disabled).toBe(
    true,
  );
  expect(screen.getByText('Save your change before sending a test.')).toBeTruthy();
});
```

Append to `src/__tests__/watchlist-screen.test.tsx`:

```tsx
test('opens the Email alerts settings', async () => {
  await renderWithClient(<WatchlistScreen />);
  await screen.findByText('AAPL');
  await fireEvent.press(screen.getByRole('button', { name: 'Email alerts' }));
  expect(mockPush).toHaveBeenLastCalledWith('/alert-settings');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/__tests__/alert-settings.test.tsx src/__tests__/watchlist-screen.test.tsx`
Expected: FAIL (module missing, button missing).

- [ ] **Step 3: Implement**

`src/hooks/use-alert-settings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const alertSettingsKey = ['alert-settings'] as const;

export function useAlertSettings() {
  return useQuery({ queryKey: alertSettingsKey, queryFn: api.getAlertSettings });
}

/** Saves the address (null clears it). The server's answer replaces the cached settings. */
export function useSaveAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) => api.saveAlertSettings(email),
    onSuccess: (data) => qc.setQueryData(alertSettingsKey, data),
  });
}

export function useSendTestEmail() {
  return useMutation({ mutationFn: () => api.sendTestAlert() });
}
```

`src/app/alert-settings.tsx`:

```tsx
import React, { useState } from 'react';

import { ErrorState, LoadingState } from '@/components/feedback/screen-state';
import { ScrollScreen } from '@/components/layout/scroll-screen';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import {
  useAlertSettings,
  useSaveAlertSettings,
  useSendTestEmail,
} from '@/hooks/use-alert-settings';
import { haptic } from '@/lib/haptics';

// Same shape the server checks: one @, no spaces, a dot in the domain. The test email is the real check.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function AlertSettingsScreen() {
  const settings = useAlertSettings();
  const save = useSaveAlertSettings();
  const test = useSendTestEmail();
  // null means "untouched": show what the server has. Once the user types, show their text.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  if (settings.isPending) return <LoadingState />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;

  const saved = settings.data.email ?? '';
  const shown = draft ?? saved;
  const dirty = shown.trim() !== saved;
  const canSend = settings.data.email_configured && saved !== '' && !dirty;

  function onSave() {
    const value = shown.trim();
    if (value !== '' && !EMAIL.test(value)) {
      setError('Enter a valid email address');
      haptic('warning');
      return;
    }
    setError(undefined);
    test.reset();
    save.mutate(value === '' ? null : value, {
      onSuccess: () => {
        setDraft(null);
        haptic('success');
      },
      onError: () => haptic('error'),
    });
  }

  return (
    <ScrollScreen avoidKeyboard>
      <ThemedText type="small" themeColor="textSecondary">
        Price alerts from your watchlist are sent to this address. Leave it empty to turn alerts
        off.
      </ThemedText>
      <TextField
        label="Send alerts to"
        error={error}
        value={shown}
        onChangeText={setDraft}
        placeholder="you@gmail.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ThemedText
        type="small"
        themeColor={settings.data.email_configured ? 'textSecondary' : 'loss'}
      >
        {settings.data.email_configured
          ? 'The server can send email.'
          : 'The server is not set up to send email yet. Set SMTP_USER and SMTP_PASSWORD in api/.env, then restart it.'}
      </ThemedText>

      {save.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {save.error.message}
        </ThemedText>
      ) : null}

      <Button title="Save" onPress={onSave} loading={save.isPending} />
      <Button
        title="Send test email"
        variant="secondary"
        onPress={() => test.mutate(undefined, { onSuccess: () => haptic('success') })}
        loading={test.isPending}
        disabled={!canSend}
      />
      {dirty ? (
        <ThemedText type="small" themeColor="textSecondary">
          Save your change before sending a test.
        </ThemedText>
      ) : null}
      {test.isSuccess ? (
        <ThemedText accessibilityRole="alert">
          Sent to {test.data.sent_to}. Check your inbox, and your spam folder if it is not there.
        </ThemedText>
      ) : null}
      {test.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {test.error.message}
        </ThemedText>
      ) : null}
    </ScrollScreen>
  );
}
```

In `src/app/_layout.tsx`, inside `<Stack.Protected guard={signedIn}>` after the `add-watch` screen, add:

```tsx
        <Stack.Screen
          name="alert-settings"
          options={{ presentation: 'modal', headerShown: true, title: 'Email alerts' }}
        />
```

In `src/app/(tabs)/watchlist.tsx` insert, directly after the `header` `View` (before the `priceNote` `View`):

```tsx
      <View style={styles.alertsRow}>
        <Button
          title="Email alerts"
          variant="secondary"
          onPress={() => router.push('/alert-settings')}
        />
      </View>
```

and add `alertsRow: { paddingBottom: Spacing.two, alignItems: 'flex-start' },` to the `StyleSheet.create` block.


- [ ] **Step 4: Run to verify it passes, then the full app checks**

Run: `npx jest src/__tests__/alert-settings.test.tsx src/__tests__/watchlist-screen.test.tsx`
Expected: PASS. Then run `npx prettier --write src`, `npx tsc --noEmit`, `npx eslint . 2>&1 | grep -v "^env:"` and `npx prettier --check .`.
Expected: no type errors, no lint errors, Prettier clean.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: Email alerts screen with address, save and test email

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs, whole-system checks and the real-email test

**Files:**
- Modify: `api/.env.example`
- Modify: `api/README.md`
- Modify: `docs/architecture.md`

**Interfaces:** none.

- [ ] **Step 1: Document the settings**

Append to `api/.env.example`:

```
# --- Price alerts by email ---
# Gmail: turn on 2-step verification, then create an app password at
# https://myaccount.google.com/apppasswords and paste it here (not your account password).
# With SMTP_USER or SMTP_PASSWORD empty, or FINNHUB_API_KEY empty, price alerts stay off.
SMTP_USER=
SMTP_PASSWORD=
# Optional (defaults shown). SMTP_FROM defaults to SMTP_USER.
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_FROM=
# ALERT_CHECK_SECONDS=120
# ALERT_COOLDOWN_SECONDS=3600
```

Add a section to `api/README.md` (after the auth section):

```markdown
## Price alerts

Each watchlist item can have an upper and a lower limit. While the server is running it checks every
`ALERT_CHECK_SECONDS` (120) and emails the address saved under Email alerts in the app when a price
reaches a limit. It emails once, re-arms when the price is back between the limits, and sends at most
one email per item per hour. Alerts only fire while the server is running and can reach Finnhub and
your mail server. Needs `FINNHUB_API_KEY`, `SMTP_USER` and `SMTP_PASSWORD` (see `.env.example`).

| Endpoint | Purpose |
| --- | --- |
| `GET/PUT /alerts/settings` | Read or set the alert email address |
| `POST /alerts/test` | Send a test email to the saved address |
```

Add to `docs/architecture.md` after the "Prices" section:

```markdown
## Price alerts

`api/app/alerts.py` holds the rules and `run_check`, which compares fresh quotes with every limit and
emails through `api/app/mailer.py`. `api/app/alert_loop.py` runs it on a background thread every
two minutes while the server is up. Each limit is `armed` or `triggered`: it emails once when
reached, stays quiet while the price is beyond it, and re-arms when the price comes back. The app
sets limits on the add-watch screen and the destination address under Email alerts.
```

- [ ] **Step 2: Run every check**

```bash
cd api && .venv/Scripts/python -m pytest -q && cd ..
npx tsc --noEmit
npx eslint . 2>&1 | grep -v "^env:"
npx prettier --check .
npx jest 2>&1 | tail -6
```

Expected: every suite passes with no type, lint or format errors.

- [ ] **Step 3: Verify the real flow by hand (what tests cannot cover)**

1. In `api/.env` set `SMTP_USER` (your Gmail address) and `SMTP_PASSWORD` (a Google app password); keep `FINNHUB_API_KEY` set.
2. Restart the server: `cd api && .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`. The log should say `price alerts are on: checking every 120 seconds`.
3. In the app: Watchlist, Email alerts, enter your real address, Save, then Send test email. Expected: "Sent to ..." and an email in your inbox.
4. Add a watchlist item with an upper limit just below the current price of a liquid stock (for example AAPL). Within about 2 minutes an email arrives with the company name, price, limit, change since yesterday's close and your note. Expected: exactly one email; the row then says `paused until the price crosses back`.
5. Raise the upper limit above the price. Expected: no email, row says `+N% to go`.

Report honestly what step 3 and 4 showed. If step 3 fails, the app shows the reason (for example `SMTPAuthenticationError` means the app password is wrong).

- [ ] **Step 4: Commit**

```bash
git add api/.env.example api/README.md docs/architecture.md
git commit -m "docs: price alert settings, endpoints and how they fit together

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage:** data model and migration (Task 2); no-surprise-email rule on migrate, create and edit (Tasks 2, 3); validation positive and lower < upper (Task 3); the check, cooldown, caps, 60 s quote age, market price store, 50-ticker cap (Task 5, Task 1 for `max_age`); email content including previous close, name, note, last-trade-day and cooldown wording, no holdings (Tasks 1, 4, 5); SMTP transport and settings (Tasks 1, 4); API settings and test endpoints with 503 / 409 / 502 (Task 6); background loop, one log line when off, shutdown (Task 7); app limit fields, row text, Email alerts screen and entry point (Tasks 8 to 10); docs and manual real-Gmail check (Task 11). The cooldown wording and the entry point were aligned in the spec in Task 1, Step 4.

**Types:** `beyond`, `initial_state`, `decide`, `run_check`, `CheckResult`, `AlertDetails`, `compose`, `Mailer`, `MailError`, `SmtpMailer`, `get_mailer`, `start_alert_loop`, `latest_price` and the app's `LimitState`, `AlertSettings` and API function names are used with identical names and signatures in every task that references them.

**Known follow-ups left out on purpose (spec Out of scope):** push, SMS, alert history, checks while the server is off, held-position limits.
