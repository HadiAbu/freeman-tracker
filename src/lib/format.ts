const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const shares = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export const formatCurrency = (n: number) => usd.format(n);

export const formatShares = (n: number) => shares.format(n);

/** Signed money, e.g. +$12.00 / -$3.50 */
export const formatSignedCurrency = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${usd.format(Math.abs(n))}`;

/** Signed percent, e.g. +4.20% */
export const formatPercent = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Today as YYYY-MM-DD in the device's local time zone. */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const isISODate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
