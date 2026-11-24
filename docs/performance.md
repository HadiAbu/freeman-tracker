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

This baseline already includes `@sentry/react-native`. The size before Sentry was not measured, so
its cost is unknown. Measure it before the next dependency is added.

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
