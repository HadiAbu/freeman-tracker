import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatShares,
  formatShortDate,
  formatSignedCurrency,
  isISODate,
  niceStep,
  todayISO,
} from '@/lib/format';

test('formatCurrency uses US dollars with cents', () => {
  expect(formatCurrency(1234.5)).toBe('$1,234.50');
  expect(formatCurrency(0)).toBe('$0.00');
});

test('formatSignedCurrency always shows the direction, and nothing for zero', () => {
  expect(formatSignedCurrency(12)).toBe('+$12.00');
  expect(formatSignedCurrency(-3.5)).toBe('-$3.50');
  expect(formatSignedCurrency(0)).toBe('$0.00');
});

test('formatPercent shows a plus sign for gains only', () => {
  expect(formatPercent(4.2)).toBe('+4.20%');
  expect(formatPercent(-4.2)).toBe('-4.20%');
  expect(formatPercent(0)).toBe('0.00%');
});

test('formatShares keeps up to six decimals and drops trailing zeros', () => {
  expect(formatShares(10)).toBe('10');
  expect(formatShares(0.123456789)).toBe('0.123457');
  expect(formatShares(1500)).toBe('1,500');
});

test.each([
  [950, '$950'],
  [1200, '$1.2K'],
  [4_500_000, '$4.5M'],
  [-1200, '-$1.2K'],
  [0, '$0'],
])('formatCompactCurrency(%p) is %p', (n, expected) => {
  expect(formatCompactCurrency(n)).toBe(expected);
});

test('formatShortDate does not shift across time zones', () => {
  expect(formatShortDate('2026-11-16')).toBe('Nov 16');
  expect(formatShortDate('2026-01-01')).toBe('Jan 1');
});

test.each([
  [0.7, 1],
  [1.5, 2],
  [3, 5],
  [7, 10],
  [130, 200],
  [0, 1],
  [-5, 1],
])('niceStep(%p) is the round step %p', (raw, expected) => {
  expect(niceStep(raw)).toBe(expected);
});

test('isISODate accepts real dates only in YYYY-MM-DD form', () => {
  expect(isISODate('2026-11-16')).toBe(true);
  expect(isISODate('2026-13-01')).toBe(false);
  expect(isISODate('2026-1-1')).toBe(false);
  expect(isISODate('16-11-2026')).toBe(false);
  expect(isISODate('')).toBe(false);
});

test('todayISO is a valid date in the local time zone', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5, 23, 30)); // local 5 Jan, late evening
  try {
    expect(todayISO()).toBe('2026-01-05');
    expect(isISODate(todayISO())).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
