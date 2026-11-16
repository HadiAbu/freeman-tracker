import { MAX_CATEGORICAL } from '@/constants/chart-theme';
import type { AllocationSlice } from '@/types';

/**
 * Color follows the entity, never its rank. The server assigns each slice a stable `slot`
 * (from the all-time first-trade order of every ticker ever traded), so a holding that grows
 * past another does not repaint and closing a position does not shift the others. This module
 * only maps a slot to a palette color and folds the tail into a gray "Other".
 */
export const OTHER_LABEL = 'Other';

export type ColoredSlice = AllocationSlice & { color: string };

/**
 * At most `maxNamed` named slices (largest first) plus one gray "Other". A slice whose slot is
 * past the palette also folds into Other. Never generates an extra hue.
 */
export function buildSlices(
  raw: AllocationSlice[],
  palette: readonly string[],
  otherColor: string,
  maxNamed = 5,
): ColoredSlice[] {
  const usable = Math.min(palette.length, MAX_CATEGORICAL);
  const named: ColoredSlice[] = [];
  let otherValue = 0;
  let otherPercent = 0;

  for (const s of raw) {
    if (named.length < maxNamed && s.slot < usable) {
      named.push({ ...s, color: palette[s.slot] });
    } else {
      otherValue += s.value;
      otherPercent += s.percent;
    }
  }
  if (otherValue > 0) {
    named.push({ label: OTHER_LABEL, value: otherValue, percent: otherPercent, slot: usable, color: otherColor });
  }
  return named;
}
