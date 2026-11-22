import { MAX_CATEGORICAL } from '@/constants/chart-theme';
import { buildSlices, OTHER_LABEL } from '@/lib/entity-colors';

const palette = Array.from({ length: MAX_CATEGORICAL }, (_, i) => `#c${i}`);
const OTHER = '#999999';
const slice = (label: string, value: number, slot: number) => ({ label, value, percent: value, slot });

test('color follows the slot, not the rank', () => {
  // B is the larger slice but has the later slot; it keeps slot 1's color
  const out = buildSlices([slice('B', 70, 1), slice('A', 30, 0)], palette, OTHER);
  expect(out.map((s) => [s.label, s.color])).toEqual([
    ['B', palette[1]],
    ['A', palette[0]],
  ]);
});

test('keeps at most five named slices and folds the tail into one gray Other', () => {
  const raw = Array.from({ length: 8 }, (_, i) => slice(`T${i}`, 10, i));
  const out = buildSlices(raw, palette, OTHER);
  expect(out).toHaveLength(6);
  expect(out.slice(0, 5).map((s) => s.label)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
  const other = out[5];
  expect(other).toMatchObject({ label: OTHER_LABEL, value: 30, percent: 30, color: OTHER });
});

test('a slice whose slot is past the palette folds into Other instead of inventing a hue', () => {
  const out = buildSlices([slice('A', 50, 0), slice('Far', 50, 99)], palette, OTHER);
  expect(out.map((s) => s.label)).toEqual(['A', OTHER_LABEL]);
  expect(out[1].value).toBe(50);
});

test('no Other slice when everything fits', () => {
  const out = buildSlices([slice('A', 60, 0), slice('B', 40, 1)], palette, OTHER);
  expect(out.map((s) => s.label)).toEqual(['A', 'B']);
});

test('an empty allocation gives no slices', () => {
  expect(buildSlices([], palette, OTHER)).toEqual([]);
});
