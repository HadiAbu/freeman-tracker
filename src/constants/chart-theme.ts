import { useColorScheme } from 'react-native';

/**
 * Chart colors. The categorical palette is the validated 8-slot reference palette
 * (adjacent-pair CVD and normal-vision checks pass in both modes against the chart
 * surfaces below). The order is the CVD-safety mechanism: never reorder, never
 * cycle past 8; fold the tail into "Other" instead.
 *
 * Light mode: aqua (3), yellow (4) and magenta (5) are under 3:1 on the surface, so
 * every chart that uses them ships visible labels or a table view beside it.
 */
const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
} as const;

/** Chart surface and ink. Contrast was validated against these exact surfaces. */
const TOKENS = {
  light: {
    surface: '#fcfcfb',
    ink: '#0b0b0b',
    inkSecondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
  },
  dark: {
    surface: '#1a1a19',
    ink: '#f0efec',
    inkSecondary: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
  },
} as const;

/** Status colors are fixed (never themed) and only used where color means good/bad. */
export const Status = { good: '#0ca30c', critical: '#d03b3b' } as const;

export const MAX_CATEGORICAL = 8;

export type ChartTheme = {
  mode: 'light' | 'dark';
  categorical: readonly string[];
  /** Series color for single-series charts. */
  primary: string;
  /** De-emphasis gray: the "Other" slice, secondary series. */
  other: string;
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  good: string;
  critical: string;
};

export function useChartTheme(): ChartTheme {
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const t = TOKENS[mode];
  const categorical = CATEGORICAL[mode];
  return {
    mode,
    categorical,
    primary: categorical[0],
    other: t.muted,
    ...t,
    good: Status.good,
    critical: Status.critical,
  };
}
