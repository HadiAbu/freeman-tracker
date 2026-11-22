import { formatCompactCurrency, formatCurrency, formatShares, formatSignedCurrency, MASK, moneyFormatters } from '@/lib/format';

test('visible: the formatters are the plain ones', () => {
  const m = moneyFormatters(false);
  expect(m.hidden).toBe(false);
  expect(m.currency).toBe(formatCurrency);
  expect(m.signedCurrency).toBe(formatSignedCurrency);
  expect(m.compactCurrency).toBe(formatCompactCurrency);
  expect(m.shares).toBe(formatShares);
});

test('hidden: every amount and share count becomes the mask', () => {
  const m = moneyFormatters(true);
  expect(m.hidden).toBe(true);
  expect(m.currency(1234.5)).toBe(MASK);
  expect(m.signedCurrency(-3)).toBe(MASK);
  expect(m.compactCurrency(4_500_000)).toBe(MASK);
  expect(m.shares(10)).toBe(MASK);
});

test('the mask does not leak the size or sign of what it hides', () => {
  const m = moneyFormatters(true);
  expect(m.currency(1)).toBe(m.currency(1_000_000));
  expect(m.signedCurrency(5)).toBe(m.signedCurrency(-5));
});
