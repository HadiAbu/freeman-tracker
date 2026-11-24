import { daysOld, isStalePrice, priceLabel } from '@/lib/price-label';

const monday = new Date(2026, 10, 23); // Mon Nov 23 2026, local time

test('counts calendar days, ignoring the time of day', () => {
  expect(daysOld('2026-11-23', new Date(2026, 10, 23, 23, 59))).toBe(0);
  expect(daysOld('2026-11-20', monday)).toBe(3);
});

test('a Friday close read on Monday is not stale, a week-old price is', () => {
  expect(isStalePrice('2026-11-20', monday)).toBe(false);
  expect(isStalePrice('2026-11-18', monday)).toBe(true);
  expect(isStalePrice(null, monday)).toBe(false);
});

test('labels say where the price came from and how old it is, in words', () => {
  expect(priceLabel('market', '2026-11-23', monday)).toBe('Market · Nov 23');
  expect(priceLabel('manual', '2026-11-20', monday)).toBe('Manual · Nov 20');
  expect(priceLabel('manual', '2026-11-10', monday)).toBe('Manual · Nov 10 · stale');
  expect(priceLabel('trade', null, monday)).toBe('Last trade price');
  expect(priceLabel(null, null, monday)).toBe('No price yet');
});
