# Architecture

How the app is laid out and where new code goes. For day-to-day rules (naming, comments, formatting)
see [conventions.md](conventions.md).

## Folders

```
src/
  app/            Screens. Every file is a route (Expo Router). No reusable code lives here.
    (tabs)/         The five tab screens: dashboard, portfolio, trades, watchlist
    holding/        Position detail            analysis/   News analysis for one ticker
    _layout.tsx     Root: providers, route guard (signed in or not), last-resort error screen
  components/     Reusable UI, grouped by what it is for (see below)
  hooks/          React hooks. Data hooks wrap TanStack Query; `use-theme` and friends read context
  lib/            Plain TypeScript with no UI: API client, session, formatting, rules
  stores/         Zustand stores (small, local state: auth status, preferences, trade draft)
  constants/      Theme tokens (spacing, colors) and chart theme
  types.ts        Shapes shared with the API
  test-utils/     Helpers and fixtures used only by tests
  __tests__/      Tests that cover a whole screen or several modules together
api/              The FastAPI backend (Python). Has its own README and tests
docs/             These docs, the release process, the phase trackers
test/             Jest setup files
```

### `src/components`

| Folder      | What goes there                                                            | Examples                                       |
| ----------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `ui/`       | Generic building blocks with no knowledge of Freeman's data                | `Button`, `TextField`, `ThemedText`, `ChipRow` |
| `rows/`     | One list row per kind of record                                            | `HoldingRow`, `TradeRow`, `WatchRow`           |
| `feedback/` | Loading, empty and error states, and the error boundaries                  | `ErrorBoundary`, `ErrorBanner`, `ErrorFallback` |
| `layout/`   | Page frames and app chrome                                                 | `Screen`, `ScrollScreen`, tabs, splash         |
| `charts/`   | Chart components and their card                                            | `ChartCard`, `TrendLine`                       |
| `analysis/` | Pieces of the news-analysis feature                                        | `CaseList`, `ResearchBox`                      |
| `prices/`   | Market price status and the automatic refresh                              | `PriceUpdated`, `PriceAutoRefresh`             |

A component's test sits next to it (`button.tsx`, `button.test.tsx`). Platform variants use the
Expo suffix (`app-tabs.web.tsx`) and stay in the same folder as the native file.

Rule of thumb: if it would make sense in another app, it is `ui/`. If it knows what a trade or a
holding is, it belongs in the folder for that feature.

## Data flow

```
screen  ->  hook (use-portfolio, use-trades, ...)  ->  api (lib/api.ts)  ->  FastAPI  ->  Turso
                    TanStack Query cache  <------------------------+
                    persisted to AsyncStorage (opens offline with the last data)
```

- **Reads** go through TanStack Query hooks. The cache is saved to the device and restored at
  launch, so the app opens with the last known data and works offline. Data older than 24 hours is dropped.
- **Writes** are mutations. They are not persisted: a trade is only saved once the server accepts it.
- **Money** is formatted through `useMoney()`, which respects the hide-balances setting.
- **Screens never call `fetch`.** Everything goes through `lib/api.ts`, which adds the access token,
  retries once after a 401 by refreshing the session, and applies a timeout.

## Accounts and sessions

`lib/session.ts` owns sign-in. The 15-minute access token lives only in memory; the 30-day refresh
token is in the device keychain (`lib/token-storage.ts`). Refresh tokens are single use, so
refreshes are single-flight: parallel callers share one request. Signing out clears the keychain,
the query cache (in memory and on disk) and the trade draft. Modules that hold account data
register with `onSessionEnd` rather than being imported by the session module, which keeps the
session testable on its own.

The route guard in `app/_layout.tsx` (`Stack.Protected`) shows the sign-in screen when signed out
and the app when signed in.

## Errors

There are three layers, from narrowest to widest:

1. **A section fails** (a chart, the analysis result): the section's own `ErrorBoundary` shows a small
   inline message with "Try again"; the rest of the screen keeps working. `ChartCard` already wraps
   its chart, so every chart is covered.
2. **A screen fails**: Expo Router's `ErrorBoundary` export in `app/_layout.tsx` shows the full-screen
   `ErrorFallback`.
3. **Async work fails** (a request, an event handler): error boundaries do **not** see these. They show
   up as the query's or mutation's `error` and are displayed with `ErrorBanner` or `ErrorState`.

Everything that is caught goes through `lib/error-reporting.ts`. It logs in development and does
nothing in release builds, so no error detail leaves the device. It is the one place to change if a
crash-reporting service is added later.

## Prices

The backend marks every price as `trade`, `manual` or `market`. `lib/price-label.ts` turns that into
words ("Market · Nov 24", "Manual · Nov 20 · stale"); a price is stale after 4 days (a weekend plus a
holiday). `PriceAutoRefresh` asks the server to refresh market prices when the app opens and when it
returns to the foreground, at most every five minutes.
