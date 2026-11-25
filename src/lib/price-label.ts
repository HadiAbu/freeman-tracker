import { formatShortDate } from '@/lib/format';
import type { PriceKind } from '@/types';

/** A price older than this many days is flagged. Four covers a normal weekend plus a market holiday. */
export const STALE_AFTER_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between an ISO date (YYYY-MM-DD) and `now`, using local calendar days.
 * Both sides go through `Date.UTC` so a daylight-saving change (a 23 or 25 hour day) cannot make
 * two adjacent dates look like 0 or 2 days apart; `Math.round` absorbs any leftover drift.
 */
export function daysOld(asOf: string, now: Date = new Date()): number {
  const [y, m, d] = asOf.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / DAY_MS);
}

export const isStalePrice = (asOf: string | null, now?: Date) =>
  asOf !== null && daysOld(asOf, now) > STALE_AFTER_DAYS;

/**
 * Where a price came from and how fresh it is, in words (never color alone):
 * "Market · Nov 24", "Manual · Nov 20 · stale", "Last trade price".
 */
export function priceLabel(kind: PriceKind | null, asOf: string | null, now?: Date): string {
  if (kind === null) return 'No price yet';
  if (kind === 'trade' || asOf === null) return 'Last trade price';
  const source = kind === 'manual' ? 'Manual' : 'Market';
  return `${source} · ${formatShortDate(asOf)}${isStalePrice(asOf, now) ? ' · stale' : ''}`;
}
