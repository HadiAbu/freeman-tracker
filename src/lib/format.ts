const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const shares = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export const formatCurrency = (n: number) => usd.format(n);

export const formatShares = (n: number) => shares.format(n);

/** Compact money for axis ticks: $950, $1.2K, $4.5M. */
export function formatCompactCurrency(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${+(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${+(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** 2026-11-16 -> Nov 16 (parsed as a local date, so no time-zone shift). */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Smallest 1/2/5 x 10^k step that is >= `raw`; keeps axis ticks round. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Signed money, e.g. +$12.00 / -$3.50 */
export const formatSignedCurrency = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}${usd.format(Math.abs(n))}`;

/** Signed percent, e.g. +4.20% */
export const formatPercent = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

/** What an amount shows as while balances are hidden. */
export const MASK = '••••';

export type MoneyFormatters = {
  hidden: boolean;
  currency: (n: number) => string;
  signedCurrency: (n: number) => string;
  compactCurrency: (n: number) => string;
  shares: (n: number) => string;
};

/**
 * The formatters for amounts of money and share counts, or the same functions returning a mask
 * when balances are hidden. Percentages and prices of a ticker are not private and stay on the
 * plain formatters.
 */
export function moneyFormatters(hidden: boolean): MoneyFormatters {
  if (!hidden) {
    return {
      hidden,
      currency: formatCurrency,
      signedCurrency: formatSignedCurrency,
      compactCurrency: formatCompactCurrency,
      shares: formatShares,
    };
  }
  const mask = () => MASK;
  return { hidden, currency: mask, signedCurrency: mask, compactCurrency: mask, shares: mask };
}

/** Today as YYYY-MM-DD in the device's local time zone. */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const isISODate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
