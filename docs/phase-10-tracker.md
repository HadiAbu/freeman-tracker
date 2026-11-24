# Phase 10: production hardening

Branch: `phase-10-production-hardening` (off `phase-9-release-channels`, which is not yet merged to `master`).
Started: 2026-11-24. This file is the live record of the phase: update it as work moves.

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and verified, `[-]` dropped.

## Working on now

- [x] Tracker and phase branch.
- [x] Item 2 (error monitoring) core, see below.
- [~] Item 8 (performance evidence): script, baseline and Trades fix done; cold start and Watchlist open.
- Next: item 1 (auth), then 6 (market prices).
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

### 1. Authentication
Decision taken (change it here if you disagree): **single-user login**, not multi-tenant. One account,
username + password, short-lived access token plus refresh token. This removes the bundled secret. Full
multi-user needs a `user_id` on every table and a data migration, so it is listed as nice to have.

Must have:
- [ ] Backend: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`; password hashed (argon2 or bcrypt); signed access token ~15 min, refresh token longer and revocable.
- [ ] Backend: every data route requires a valid access token; `X-API-Key` removed or kept only behind a flag for scripts.
- [ ] Backend: login rate limiting; fail closed when no credentials are configured.
- [ ] Backend tests for login, expiry, refresh, bad token, rate limit.
- [ ] App: login screen, token kept in `expo-secure-store` (never AsyncStorage), auth state in Zustand.
- [ ] App: API client attaches the token and refreshes once on 401, then signs out.
- [ ] App: route guard so signed-out users only see login; sign-out clears the Query cache and persisted data.
- [ ] Remove `EXPO_PUBLIC_API_KEY` from the app, `eas.json` docs and `docs/releasing.md`.
- [ ] App tests for login, guard, 401 refresh and sign-out.

Nice to have:
- [ ] Biometric unlock with `expo-local-authentication`.
- [ ] Multi-user support (`user_id` columns, migration).
- [ ] Sign in with Apple/Google.
- [ ] Device list and remote sign-out.

### 6. Automatic market prices
Must have:
- [ ] Backend: price provider behind an interface (Finnhub is already a dependency for news), with a short cache and rate-limit handling.
- [ ] Backend: refresh endpoint that stores fetched prices as price marks tagged with their source and time.
- [ ] App: refresh on pull-to-refresh and on app foreground, with a "last updated" label and a stale-price marker.
- [ ] Manual prices still work and are visibly distinct from fetched ones.
- [ ] Graceful failure: a provider outage shows last known prices, not an error screen.
- [ ] Tests with a fake provider (no network in CI).

Nice to have:
- [ ] Background refresh while the app is closed.
- [ ] Streaming/WebSocket prices.
- [ ] Previous-close and day change per holding.
- [ ] Provider fallback (second source when the first fails).

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-11-24 | New branch `phase-10-production-hardening` off `phase-9-release-channels` | Phase 9 is not merged to `master` yet; branch rule says build on it |
| 2026-11-24 | Auth is single-user first | Multi-tenant needs a schema migration; do the security fix first |
| 2026-11-24 | Sentry stays inert without a DSN | Keeps tests, CI and local dev free of network and config |

## Open questions

- Which market data provider and plan for item 6? Finnhub free tier is the default assumption.
- A Sentry account and DSN are needed for item 2 to report anything real.
- `freeman-api` lives in the parent `CLaude` repo, which has many unrelated uncommitted changes. Backend
  edits will be made as files only and not committed there without your say-so.

## Risks

- Removing the API key breaks any build that still uses it. Needs a new build and a runtime version bump (see `docs/releasing.md`).
- Adding `@sentry/react-native` and `expo-secure-store` adds native code, so OTA alone cannot ship them.

## Log

| Date | Change |
|---|---|
| 2026-11-24 | Created branch and this tracker |
| 2026-11-24 | Item 2: `@sentry/react-native` added, `src/lib/monitoring.ts` (inert without `EXPO_PUBLIC_SENTRY_DSN`, scrubs money fields, tags channel/update ID), root `ErrorBoundary`, API-failure breadcrumbs. tsc, lint and 263 tests pass. **Not yet verified on a device/release build** (needs a DSN and a new native build). Source maps and the rollout-watching doc step are still open. |
| 2026-11-24 | Item 8: `scripts/perf-bundle.mjs`, `docs/performance.md`, baseline bundle ~7 MB per platform. Trades rows redrew 5 of 5 on an unrelated update, now 0 (`React.memo`, `useCallback`, hoisted separator) with a regression test. tsc, lint and full tests pass. |
