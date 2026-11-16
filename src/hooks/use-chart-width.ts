import { useWindowDimensions } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';

/** Drawable width inside a chart card: content column minus screen and card padding. */
export function useChartWidth(): number {
  const { width } = useWindowDimensions();
  return Math.max(200, Math.min(width, MaxContentWidth) - Spacing.three * 4);
}
