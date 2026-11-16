import { MAX_CATEGORICAL } from '@/constants/chart-theme';
import type { AllocationBy, AllocationSlice, Holding, Trade } from '@/types';

/**
 * Color follows the entity, never its rank. A ticker's palette slot comes from when it
 * was first traded, so a holding that grows past another does not repaint, and closing
 * a position does not shift the colors of the rest.
 */
export const OTHER_LABEL = 'Other';
export const UNASSIGNED = 'Unassigned';

/** Every ticker ever traded, in order of first trade (date, then id). */
export function tickerOrder(trades: Trade[]): string[] {
  const sorted = [...trades].sort((a, b) => a.traded_at.localeCompare(b.traded_at) || a.id - b.id);
  const seen: string[] = [];
  for (const t of sorted) if (!seen.includes(t.ticker)) seen.push(t.ticker);
  return seen;
}

/** label -> palette slot for one allocation dimension. */
export function labelSlots(
  by: AllocationBy,
  holdings: Holding[],
  order: string[],
): Map<string, number> {
  if (by === 'ticker') return new Map(order.map((t, i) => [t, i]));

  // Sector / asset class: slot by the earliest first-trade among the tickers in the group.
  const firstSeen = new Map<string, number>();
  for (const h of holdings) {
    const label = h[by] ?? UNASSIGNED;
    const rank = order.indexOf(h.ticker);
    firstSeen.set(label, Math.min(firstSeen.get(label) ?? Infinity, rank < 0 ? Infinity : rank));
  }
  const labels = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  return new Map(labels.map((l, i) => [l, i]));
}

export type ColoredSlice = AllocationSlice & { color: string };

/**
 * At most `maxNamed` named slices (largest first) plus one gray "Other". Entities whose
 * slot is past the palette also fold into Other. Never generates an extra hue.
 */
export function buildSlices(
  raw: AllocationSlice[],
  slots: Map<string, number>,
  palette: readonly string[],
  otherColor: string,
  maxNamed = 5,
): ColoredSlice[] {
  const named: ColoredSlice[] = [];
  let otherValue = 0;
  let otherPercent = 0;

  for (const s of raw) {
    const slot = slots.get(s.label);
    if (named.length < maxNamed && slot !== undefined && slot < Math.min(palette.length, MAX_CATEGORICAL)) {
      named.push({ ...s, color: palette[slot] });
    } else {
      otherValue += s.value;
      otherPercent += s.percent;
    }
  }
  if (otherValue > 0) {
    named.push({ label: OTHER_LABEL, value: otherValue, percent: otherPercent, color: otherColor });
  }
  return named;
}
