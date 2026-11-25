# Price alerts by email - design

Status: draft for review. Branch: `phase-12-price-alerts` (built on `phase-11-code-quality`).

## Goal

On the watchlist, let a user set an **upper limit** and a **lower limit** per stock, and get an
**email** when the price reaches either.

## Decisions already made

| Decision | Choice |
| --- | --- |
| Where the checker runs | Inside the API server (a background thread), on the user's PC. Alerts only fire while the server runs. |
| Email transport | SMTP via Python's `smtplib`; Gmail defaults (`smtp.gmail.com:587`, STARTTLS) with a Google app password |
| After an alert fires | Fire once; re-arm when the price is back inside the limits |
| Existing `target_price` | Becomes the upper limit. A new lower limit is added. |
| Alert email address | Set in the app (per account), with a "Send test email" button |
| Push notifications | Dropped. Email only. |

## Out of scope (for now)

Push notifications and SMS; percentage-move or volume alerts; alert history; checks while the server
is off (a hosted server or a scheduled job would fix that and needs no redesign: the check is one
plain function).

## Data model

Applied through the existing `_migrate` in `api/app/db.py`, safe to run on every start.

```text
watchlist
  target_price   -> renamed upper_limit        (alert when price >= it)
  + lower_limit      REAL NULL                 (alert when price <= it)
  + upper_state      TEXT 'armed'|'triggered'  default 'armed'
  + lower_state      TEXT 'armed'|'triggered'  default 'armed'
  + last_alerted_at  TEXT NULL

users
  + alert_email      TEXT NULL                 (empty = alerts off for this account)
```

- **No surprise emails from the migration.** For each existing limit, if the latest known price is
  already beyond it, its state starts as `triggered`. It emails only after the price returns inside
  and crosses again. The same rule applies whenever a limit is created or edited through the API.
- Implementation must verify that libsql supports `ALTER TABLE ... RENAME COLUMN`; if not, add
  `upper_limit`, copy `target_price` into it, and stop reading the old column.
- `alert_email` is separate from the login email, because the login email can be a placeholder.
  With no `alert_email`, no email is sent (it never falls back to the login email).
- Validation: limits are positive, and `lower_limit < upper_limit` when both are set.

## The check

A pure function `run_check(conn, quotes, mailer, now)` plus a thin loop that calls it every
`ALERT_CHECK_SECONDS` (default 300) on a daemon thread started with the app. Each cycle opens its own
database connection.

```text
tickers = every ticker with a limit, across all users, deduplicated, at most 50
for each ticker: quote it (shared 120 s cache, same Finnhub provider as price refresh); also store
                 the price as today's market mark so the app is fresh
for each limit on that ticker:
    beyond = price >= upper_limit        (or price <= lower_limit)
    if beyond and state == armed and cooldown (1 hour since last_alerted_at) has passed:
        send the email
        on success: state = triggered, last_alerted_at = now
        on failure: stay armed, retry next cycle
    if not beyond and state == triggered:  state = armed
```

- A failed quote leaves that ticker's alerts untouched for the cycle.
- If the account has no `alert_email`, or the server has no SMTP settings, the alert stays armed (it is
  not silently dropped) and the settings screen says why.
- At most 20 emails per cycle.
- The loop starts with the server. With no SMTP settings it logs one line and does nothing else.

## Email

`smtplib`, 10 s timeout. Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM`. The password is never logged. Content holds only a ticker, a price and a limit, built
from a validated ticker and numbers, so there is no header injection. Never holdings or share counts:

```text
Subject: AAPL rose above your upper limit
AAPL is $190.12, above your upper limit of $190.00.
```

## API (all authenticated, all scoped to the signed-in user)

- `POST /watchlist`, `PATCH /watchlist/{id}`: accept `upper_limit` and `lower_limit`; responses include
  both states so the row can say when an alert is paused.
- `GET /alerts/settings`: `{ email, email_configured }` (`email_configured` = the server has SMTP settings).
- `PUT /alerts/settings`: set or clear the address (basic format check).
- `POST /alerts/test`: sends a test email to the saved address; 503 with a plain message when SMTP is
  not configured, 409 when no address is saved.

## App

- **Add/edit watch screen:** "Alert above" and "Alert below" fields with a line saying you will be
  emailed. (The old "Target price" label and its "X% to go" text become the upper limit.)
- **Watch row:** `Alert above $190.00 · 4.2% to go`, `Alert below $150.00`; a limit already beyond
  shows `paused until the price crosses back`.
- **Alert email screen** (opened from the account button): the address field, "Send test email", and a
  line saying whether the server has email set up.
- This is JavaScript only: no new native module, no new build for this feature.

## Errors and privacy

- Every failure is non-fatal and logged without secrets. Nothing in an alert carries holdings, share
  counts or balances. The SMTP password is never logged or returned by the API.
- A broken email setup shows up in the test button; the checker keeps retrying quietly.

## Testing (TDD)

- **State machine:** fires once, re-arms, respects the cooldown, a failed send retries and stays armed,
  no address keeps it armed.
- **Migration:** `target_price` becomes `upper_limit`; an existing limit already beyond the latest
  price starts `triggered`; running it twice changes nothing.
- **API:** validation (positive, lower < upper), per-user isolation of settings, test endpoint's 503/409.
- **Check:** fake clock, fake quote provider and fake mailer.
- **App:** the form, the row text for each state, the alert email screen.
- **Not verifiable in tests:** a real Gmail send. It is checked by hand and reported as such.

## Setup you need to do (I cannot)

Gmail: turn on 2-step verification, create an app password, and put it in `api/.env` as
`SMTP_PASSWORD` with your address as `SMTP_USER` (and `SMTP_FROM`). Nothing else is needed.

## Build order

1. Backend: schema and migration, limits and validation, `run_check`, email sending, settings and test
   endpoints, background loop. Testable on this PC with curl and a real Gmail send.
2. App: limit fields, row text, alert email screen.

## Risks and things to verify while building

- `ALTER TABLE ... RENAME COLUMN` on libsql (see above).
- A background thread plus request threads all use libsql; each uses its own connection, but
  alert-state writes and watchlist edits can interleave. State updates are single `UPDATE`
  statements keyed by id, which keeps this safe, but it needs a concurrency test.
- With `uvicorn --reload`, make sure only the serving process runs the loop, and document that two
  server processes would double-send.
- Gmail may refuse an app password if 2-step verification is off, and it limits sending to roughly
  500 emails a day: far above what one watchlist produces.
