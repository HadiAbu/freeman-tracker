# Phase 10: production hardening

Branch: `phase-10-production-hardening` (off `phase-9-release-channels`, which is not yet merged to `master`).
Started: 2026-11-24. This file is the live record of the phase: update it as work moves.

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and verified, `[-]` dropped.

## Working on now

- [x] Tracker and phase branch.
- [x] Item 2 (error monitoring) core, see below.
- [~] Item 8 (performance evidence): script, baseline and Trades fix done; cold start and Watchlist open.
- [~] Item 1 (auth), multi-user: backend and app done and tested; needs a device run. See below.
- [~] Item 6 (market prices): backend and app done and tested; one live Finnhub quote verified. Needs a device run.
- Next: run the app on a device against the real server, then merge decisions (see Open questions).
  Order is smallest and least risky first. Auth is the biggest change and touches both repos, so it goes
  after the quick wins.

## Scope

| # | Item | Why it matters | Repos touched |
|---|---|---|---|
| 1 | Real authentication, replacing the bundled `EXPO_PUBLIC_API_KEY` | The key ships inside the app bundle and anyone can read it | app + `freeman-api` |
| 2 | Crash and error monitoring (Sentry) plus a root error boundary | No visibility into crashes; staged rollouts need a health signal | app |
| 6 | Automatic market prices | Prices are manual today, the biggest functional gap | app + `freeman-api` |
| 8 | Performance evidence | Claims without numbers do not convince anyone | app |

## Plan and must-haves

### 2. Error monitoring
Must have:
- [x] Root error boundary with a recovery screen (Expo Router `ErrorBoundary` export in `_layout.tsx`).
- [x] Sentry initialised from `EXPO_PUBLIC_SENTRY_DSN`; does nothing when the DSN is unset (dev, tests, CI).
- [x] Release channel and update ID attached to every event, so errors can be tied to a rollout.
- [x] Unit test: boundary renders the fallback and the retry button recovers.

Nice to have:
- [ ] Source maps uploaded from EAS builds.
- [x] Breadcrumbs for API failures (status and path only, never bodies or amounts).
- [x] Scrub balances and share counts from events (`beforeSend`).
- [ ] Document the "watch crash-free rate during the 10% rollout" step in `docs/releasing.md`.

### 8. Performance evidence
Must have:
- [~] Baseline numbers recorded in `docs/performance.md`: bundle size done; cold start and scroll frame rate need a device (not done).
- [~] Trades list fixed (rows were all redrawing). Watchlist has the same issue, unfixed. Holdings are in a ScrollView, not virtualized.
- [x] A repeatable script (`npm run perf:bundle`) so the numbers can be regenerated.
- [x] Before/after table for every change made (so far: the Trades rows).

Nice to have:
- [ ] Bundle-size check in CI that fails on a large regression.
- [~] Re-render counts: Trades covered by a test; other screens not.
- [ ] Swap to `FlashList` only if the numbers justify it.

### 1. Authentication (multi-user)
Decision (changed 2026-11-24): **multi-user**, not single-user. Each account sees only its own data.
Email + password, short-lived access token (15 min) plus single-use rotating refresh token.

Must have:
- [x] Backend: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, gated `POST /auth/register`; argon2id passwords; HS256 access tokens; refresh tokens stored hashed, rotated on use, whole family revoked on replay.
- [x] Backend: every data route requires a valid access token and filters by it; `X-API-Key` removed. Another user's row id answers 404.
- [x] Backend: login throttle (per account and per address, 429 + `Retry-After`); fails closed (503) with no `JWT_SECRET`; registration closed by default.
- [x] Backend: schema migration for databases from the single-user version (existing data and price marks adopted by account id 1) and a `scripts/create_user` command.
- [x] Backend tests: auth flows, expiry, forgery, refresh rotation and replay, throttle, per-user isolation on every route, migration (238 tests pass).
- [x] App: sign-in / create-account screen; refresh token in `expo-secure-store`, access token in memory only; auth state in Zustand.
- [x] App: API client attaches the bearer token, refreshes once on 401 (single flight) then ends the session; offline never signs the user out.
- [x] App: route guard (`Stack.Protected`); sign-out revokes the token, clears the keychain, the query cache (memory and disk) and the trade draft.
- [x] `EXPO_PUBLIC_API_KEY` removed from app, tests and docs.
- [x] App tests: session, API client refresh/retry, sign-in screen, guard, sign-out button (291 tests pass).
- [ ] **Run it on a device or simulator against the real server.** Not done. Everything above is verified only by unit tests with a faked network and a faked keychain.
- [ ] Rotate the old shared key: remove `API_KEY` from the production server `.env`, delete `EXPO_PUBLIC_API_KEY` from EAS environments.
- [ ] Create the first account on the production database *before* opening registration (it becomes id 1 and inherits existing data).

Nice to have:
- [ ] Biometric unlock with `expo-local-authentication`.
- [ ] Password reset / change password (needs email delivery).
- [ ] Sign in with Apple/Google.
- [ ] Device list and remote sign-out.
- [ ] Database-backed login throttle (the in-memory one covers a single server process only).
- [ ] Per-user cap on daily analyses is per account; add a global cap if the OpenAI bill matters.

### 6. Automatic market prices
Provider: Finnhub free tier (already used for news; same `FINNHUB_API_KEY`).

Must have:
- [x] Backend: `QuoteProvider` interface, Finnhub implementation, shared 120 s cache across users, 20 s time budget, max 50 tickers per refresh.
- [x] Backend: `POST /prices/refresh` stores shared `market` marks, one per ticker per day (a second refresh the same day updates it).
- [x] Backend: holdings and watchlist report `price_kind` (manual / market / trade) and `price_as_of`; the same-day tie goes to the user's own manual mark.
- [x] App: refresh on launch and each return to the foreground (at most every 5 min), and on pull-to-refresh of Dashboard, Portfolio and Watchlist.
- [x] App: "Prices updated 3:42 PM" label, "N could not be updated" note, and a stale marker (older than 4 days) in words, not only color.
- [x] Manual prices still work and are labelled "Manual" next to "Market".
- [x] Graceful failure: provider errors are listed per ticker and keep the last price; 503 (no key) switches the app to "showing the prices you entered" and stops asking.
- [x] Tests with a fake provider and a fake transport; no network in CI (API 265, app 305).
- [x] One real Finnhub quote verified from this machine (AAPL).
- [ ] **Run the whole flow on a device.** Not done.

Nice to have:
- [ ] Background refresh while the app is closed.
- [ ] Streaming/WebSocket prices.
- [ ] Previous close and day change per holding (the Finnhub quote already returns `pc`).
- [ ] Second provider as a fallback.
- [ ] Skip refreshes outside market hours.

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-11-24 | New branch `phase-10-production-hardening` off `phase-9-release-channels` | Phase 9 is not merged to `master` yet; branch rule says build on it |
| 2026-11-24 | Auth is multi-user (supersedes single-user-first) | Requested; the schema already had `user_id` everywhere but prices, so the migration is small |
| 2026-11-24 | API moved into this repo under `api/` | One repo, one CI, app and server change together. History stays in the old parent repo |
| 2026-11-24 | Registration closed by default; accounts via `scripts.create_user` | An open endpoint on a public server would let a stranger claim the existing data as user 1 |
| 2026-11-24 | Access token in memory, refresh token in the keychain; web keeps both in memory | localStorage is readable by any script on the page |
| 2026-11-24 | Sentry stays inert without a DSN | Keeps tests, CI and local dev free of network and config |

## Open questions

- Finnhub's free tier is for personal use; check its terms before serving many users.
- Phase 9 and this phase are both unmerged to `master`. Merge in order (9 then 10) per the phase-branch workflow once verified on a device.
- A pytest run crashed once with a native fault dump (traceback through `pytest/__main__`) and passed on every rerun. Not reproduced; if it recurs, suspect the `libsql` native module.
- A Sentry account and DSN are needed for item 2 to report anything real.
- The old `freeman-api/` folder was deleted from the parent `CLaude` repo's working tree after the move. Those deletions are uncommitted there; `git -C .. checkout -- freeman-api` restores them. Decide whether to commit the removal.

## Risks

- Removing the API key breaks any build that still uses it. Needs a new build; `expo.version` is bumped to 1.1.0 so OTA updates only reach new builds.
- Every existing user of the old build is locked out until they install the new one and sign in.
- Web: the session is memory-only, so a page reload signs the user out.
- Adding `@sentry/react-native` and `expo-secure-store` adds native code, so OTA alone cannot ship them.

## Log

| Date | Change |
|---|---|
| 2026-11-24 | Created branch and this tracker |
| 2026-11-24 | Item 2: `@sentry/react-native` added, `src/lib/monitoring.ts` (inert without `EXPO_PUBLIC_SENTRY_DSN`, scrubs money fields, tags channel/update ID), root `ErrorBoundary`, API-failure breadcrumbs. tsc, lint and 263 tests pass. **Not yet verified on a device/release build** (needs a DSN and a new native build). Source maps and the rollout-watching doc step are still open. |
| 2026-11-24 | Item 8: `scripts/perf-bundle.mjs`, `docs/performance.md`, baseline bundle ~7 MB per platform. Trades rows redrew 5 of 5 on an unrelated update, now 0 (`React.memo`, `useCallback`, hoisted separator) with a regression test. tsc, lint and full tests pass. |
| 2026-11-24 | API moved to `api/` with its own CI job (202 tests passed in the new location before any change). |
| 2026-11-24 | Item 1: multi-user auth, backend (238 tests) and app (291 tests); tsc and lint clean. Not run on a device. |
| 2026-11-24 | Item 6: Finnhub price refresh (API 265 tests, app 305, coverage 85%), shared cache, labels and stale marker. Real server smoke-tested with curl (login, rotation, replay, 401/403/503 paths). |
