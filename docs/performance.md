# Performance

Numbers for this app, how they were measured, and what changed them. Regenerate with the commands
below; do not edit numbers by hand.

## How to measure

| What | Command | Notes |
|---|---|---|
| Shipped JS and assets | `npm run perf:bundle` | Production `expo export` per platform; Hermes bytecode size. Takes about 2 minutes |
| Row re-renders | `npx jest src/__tests__/trades-rerenders.test.tsx` | Counts renders of the Trades rows when an unrelated parent update happens |

## Baseline (2026-11-24, branch `phase-10-production-hardening`)

| Platform | JS bundle (Hermes) | Assets | Asset files |
|---|---|---|---|
| android | 7074 KB | 4956 KB | 46 |
| ios | 7006 KB | 4004 KB | 42 |

This baseline was taken with `@sentry/react-native` installed, before the account and market-price
code was added. See "Sentry removed" below for the size after it was taken out.

## Changes

| Change | Metric | Before | After |
|---|---|---|---|
| `React.memo` on `TradeRow`, stable `onDelete` and `renderItem`, hoisted list separator | Trades rows redrawn by one unrelated parent update (5 rows) | 5 | 0 |

## Not yet measured (do not claim)

- Cold start time. Needs a release build on a real device; Jest cannot measure it.
- Scroll frame rate on a long Trades list. Same reason.
- The Watchlist list has the same pattern as Trades (inline `renderItem`, inline separator, unmemoized
  row). Not changed yet. The Portfolio holdings are mapped inside a `ScrollView`, not a `FlatList`;
  fine for tens of holdings, would need virtualizing at hundreds.

## Sentry removed (phase 11, 2026-11-25)

Measured with `npm run perf:bundle` after removing `@sentry/react-native`. This build also contains
the phase 10 accounts and market-price code that the baseline above predates, so the drop is
Sentry's cost minus what those features added.

| Platform | JS bundle (Hermes) | Baseline | Change   |
| -------- | ------------------ | -------- | -------- |
| android  | 5093 KB            | 7074 KB  | -1981 KB |
| ios      | 5023 KB            | 7006 KB  | -1983 KB |

Assets are unchanged (android 4956 KB in 46 files, ios 4004 KB in 42 files). Native code size (the
Sentry SDK's native modules) is not part of this number and was not measured.
