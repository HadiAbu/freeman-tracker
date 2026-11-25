# Price alerts (email and push) - design

Status: draft for review. Branch: `phase-12-price-alerts` (built on `phase-11-code-quality`).

## Goal

On the watchlist, let a user set an **upper limit** and a **lower limit** per stock, and be told
when the price reaches either: by **email** and by **push notification**, each switchable.

## Decisions already made

| Decision | Choice |
| --- | --- |
| Where the checker runs | Inside the API server (a background thread), on the user's PC. Alerts only fire while the server runs. |
| Email transport | SMTP via Python's `smtplib`; Gmail defaults (`smtp.gmail.com:587`, STARTTLS) with a Google app password |
| Push transport | Expo Push service (`https://exp.host/--/api/v2/push/send`) |
| Phone | Android (needs a free Firebase project; no paid developer account) |
| After an alert fires | Fire once; re-arm when the price is back inside the limits |
| Existing `target_price` | Becomes the upper limit. A new lower limit is added. |
| Alert email address | Set in the app (per account), with a "Send test email" button |
| Channels | Email and push, each with an on/off toggle, both on by default |

## Out of scope (for now)

SMS; percentage-move or volume alerts; alert history; checks while the server is off (a hosted server
or a scheduled job would fix that and needs no redesign: the check is one plain function); push on
web (the Expo notifications docs list Android and iOS only); iOS push (needs a paid Apple Developer
account); deep-linking a tapped notification to a specific screen (it opens the app).

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
  + alert_email          TEXT NULL
  + alert_email_enabled  INTEGER default 1
  + alert_push_enabled   INTEGER default 1

push_tokens (new)
  id, user_id, token UNIQUE, platform, created_at, last_seen_at
```

- **No surprise emails from the migration.** For each existing limit, if the latest known price is
  already beyond it, its state starts as `triggered`. It emails only after the price returns inside
  and crosses again. The same rule applies whenever a limit is created or edited through the API.
- Implementation must verify that libsql supports `ALTER TABLE ... RENAME COLUMN`; if not, add
  `upper_limit`, copy `target_price` into it, and stop reading the old column.
- `alert_email` is separate from the login email, because the login email can be a placeholder.
  With no `alert_email`, the email channel is skipped (never falls back to the login email).
- Validation: limits are positive, and `lower_limit < upper_limit` when both are set.

## The check

A pure function `run_check(conn, quotes, notifiers, now)` plus a thin loop that calls it every
`ALERT_CHECK_SECONDS` (default 300) on a daemon thread started with the app. Each cycle opens its own
database connection.

```text
tickers = every ticker with a limit, across all users, deduplicated, at most 50
for each ticker: quote it (shared 120 s cache, same Finnhub provider as price refresh); also store
                 the price as today's market mark so the app is fresh
for each limit on that ticker:
    beyond = price >= upper_limit        (or price <= lower_limit)
    if beyond and state == armed and cooldown (1 hour since last_alerted_at) has passed:
        deliver on every enabled channel
        if at least one channel succeeded: state = triggered, last_alerted_at = now
        if every enabled channel failed:   stay armed, retry next cycle
    if not beyond and state == triggered:  state = armed
```

- A failed quote leaves that ticker's alerts untouched for the cycle.
- If a user has no usable destination (email off or unset or SMTP missing, and no push token), the
  alert stays armed and the settings screen says why; it is not silently dropped.
- A channel that fails after another succeeded is not retried for that alert (a missed duplicate is
  better than a repeated one). Accepted.
- At most 20 emails per cycle. Pushes are sent in batches of up to 100.

## Delivery

**Email.** `smtplib`, 10 s timeout. Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM`. The password is never logged. Content holds only a ticker, a price and a limit, built
from a validated ticker and numbers, so there is no header injection:

```text
Subject: AAPL rose above your upper limit
AAPL is $190.12, above your upper limit of $190.00.
```

**Push.** `POST https://exp.host/--/api/v2/push/send` with `to`, `title`, `body`, `channelId`
(`price-alerts`) and `data: { type: "alert", ticker }`; no authentication is required by default.
Same minimal content as email, never share counts or holdings. The returned ticket is not proof of
delivery (it only means Expo received it), so the server keeps the ticket ids and checks
`POST /push/getReceipts` on a later cycle (the docs suggest about 15 minutes; receipts expire after 24
hours). `DeviceNotRegistered`, in a ticket or a receipt, deletes that token. Retry only on HTTP 429 and
5xx, with backoff; never on 400. Receipts pending at a server restart are lost; accepted.

## API (all authenticated, all scoped to the signed-in user)

- `POST /watchlist`, `PATCH /watchlist/{id}`: accept `upper_limit` and `lower_limit`; responses include
  both states so the row can say when an alert is paused.
- `GET /alerts/settings`: `{ email, email_enabled, push_enabled, push_devices, email_configured }`
  (`email_configured` = the server has SMTP settings).
- `PUT /alerts/settings`: set the address and the two toggles.
- `POST /alerts/test`: body `{ channel: "email" | "push" }`. Sends a test to that channel; 503 with a
  plain message when SMTP is not configured, 409 when there is no registered device.
- `PUT /alerts/push-token` and `DELETE /alerts/push-token`: register or remove this device's token.
  A token already stored for another user is re-assigned to the caller (the device changed hands).

## App

- **Add/edit watch screen:** "Alert above" and "Alert below" fields with a line saying you will be
  notified. (The old "Target price" label and its "X% to go" text become the upper limit.)
- **Watch row:** `Alert above $190.00 · 4.2% to go`, `Alert below $150.00`; a limit already beyond
  shows `paused until the price crosses back`.
- **Alert settings screen** (opened from the account button): the alert email field, email and push
  toggles, "Send test email" and "Send test push", a line saying whether the server has email set up
  and how many devices are registered.
- **Push registration** (new `expo-notifications` and `expo-constants`, installed with
  `npx expo install`): after sign-in, create the Android channel `price-alerts` (this must happen
  before the permission prompt can appear), ask permission, get the Expo push token with the EAS
  `projectId`, send it to `PUT /alerts/push-token`, and re-send if the token rolls
  (`addPushTokenListener`). Catch and retry on offline failures. A foreground handler shows the
  notification while the app is open. **Sign-out unregisters the device first** so a signed-out
  phone never receives the account's alerts.
- `app.json`: add `"expo-notifications"` to `plugins`, set `android.googleServicesFile`. These need a
  new native build.

## Errors and privacy

- Every failure is non-fatal and logged without secrets. Nothing in an alert carries holdings,
  share counts or balances.
- Token and password values are never logged or returned by the API.
- A broken email setup shows up in the test button; the checker keeps retrying quietly.

## Testing (TDD)

- **State machine:** fires once, re-arms, respects the cooldown, failed send retries, both channels
  failing keeps it armed, one succeeding triggers it.
- **Migration:** `target_price` becomes `upper_limit`; an existing limit already beyond the latest
  price starts `triggered`; running it twice changes nothing.
- **API:** validation (positive, lower < upper), per-user isolation of settings and tokens, token
  re-assignment, test endpoints' 503/409.
- **Delivery:** fake clock, fake quote provider, fake mailer and fake Expo push client. Push: batching,
  `DeviceNotRegistered` removes the token, no retry on 400.
- **App:** the form, the row text for each state, the settings screen, push registration (with
  `expo-notifications` mocked), sign-out unregistering.
- **Not verifiable in tests:** a real Gmail send, a real push to a phone, and Android's permission
  prompt. These are checked by hand and reported as such.

## Setup you need to do (I cannot)

1. **Gmail:** turn on 2-step verification and create an app password; put it in `api/.env` as
   `SMTP_PASSWORD` with your address as `SMTP_USER`.
2. **Firebase (free):** create a project, add an Android app with this app's package name, download
   `google-services.json` into the project root, generate a service-account private key, and upload it
   to EAS with `eas credentials` (Android, Google Service Account Key for Push Notifications, FCM V1).
   Keep the service-account JSON out of git.
3. **A new Android development build** (Expo Go cannot do push on Android since SDK 53). Either build
   locally (needs Android Studio, not installed today) or with EAS (uses build minutes). This is the
   same pending decision as the phase 10 device run, and one build can serve both.

## Build order

1. Backend: schema and migration, limits and validation, `run_check`, email delivery, settings and test
   endpoints, background loop. Testable on this PC with curl and a real Gmail send, no build needed.
2. App: limit fields, row text, alert settings screen (email part).
3. Push: token table and endpoints, Expo sender and receipts, then app registration, which needs the
   new build and the Firebase setup above.

## Risks and things to verify while building

- `ALTER TABLE ... RENAME COLUMN` on libsql (see above).
- The docs mention a `MismatchSenderId` entry that still names the legacy FCM server key, which
  contradicts their FCM V1 instructions. If push fails with that error, check credentials first.
- Whether remote push works in Expo Go on iOS is undocumented; irrelevant here (Android only).
- A background thread plus a request thread both use libsql; each uses its own connection, but
  alert-state writes and watchlist edits can interleave. State updates are single `UPDATE`
  statements keyed by id, which keeps this safe, but it needs a concurrency test.
- With `uvicorn --reload`, a second process can start a second checker. Guard the loop so it runs
  only in the serving process, and document that running two server processes would double-send.
