import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { ChartNote } from '@/components/charts/chart-card';
import { useChartTheme } from '@/constants/chart-theme';
import { Spacing } from '@/constants/theme';
import { useChartWidth } from '@/hooks/use-chart-width';
import { useMoney } from '@/hooks/use-money';
import { formatCompactCurrency, formatCurrency, formatShortDate, niceStep } from '@/lib/format';

export type TrendPoint = { date: string; value: number };

type Props = {
  points: TrendPoint[];
  primaryName: string;
  /** Optional second series on the same axis (e.g. cost basis), drawn in de-emphasis gray. */
  secondary?: number[];
  secondaryName?: string;
  emptyHint?: string;
  /** The values are the user's own money (not a market price): mask them while balances are hidden. */
  sensitive?: boolean;
};

const Y_LABEL_WIDTH = 52;
const INITIAL_SPACING = 12;
const END_SPACING = 20;
const HEIGHT = 160;
const MAX_POINTS = 60;

/** Indices of at most `max` evenly spread points out of `n`, including the first and last. */
function sampleIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < max; i++) out.add(Math.round((i * (n - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * Single-axis line chart: 2px line, ~10% area wash, one 8px end dot with a surface ring,
 * solid hairline grid, selective x labels (first and last), tooltip on touch.
 */
export function TrendLine({
  points: allPoints,
  primaryName,
  secondary: allSecondary,
  secondaryName,
  emptyHint,
  sensitive = false,
}: Props) {
  const c = useChartTheme();
  const money = useMoney();
  const mask = sensitive && money.hidden;
  const width = useChartWidth();
  // A phone cannot show more than a few dozen distinct points, and the library gives each
  // x label only one point's width. Thin long histories evenly (always keeping first and last).
  const picked = sampleIndices(allPoints.length, MAX_POINTS);
  const points = picked.map((i) => allPoints[i]);
  const secondary = allSecondary ? picked.map((i) => allSecondary[i]) : undefined;
  const n = points.length;

  if (n < 2) {
    return <ChartNote>{emptyHint ?? 'Not enough data yet to draw a line.'}</ChartNote>;
  }

  // small safety margin: the grid otherwise pokes past the card edge on native
  const plotWidth = width - Y_LABEL_WIDTH - 12;
  const spacing = (plotWidth - INITIAL_SPACING - END_SPACING) / (n - 1);

  const all = [...points.map((p) => p.value), ...(secondary ?? [])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const step = niceStep((max - min) / 3 || max * 0.1 || 1);
  // Lines do not need a zero baseline; start one step below the data so changes are visible.
  const offset = Math.max(0, Math.floor(min / step) * step - step);
  const top = Math.ceil(max / step) * step;
  const sections = Math.max(2, Math.round((top - offset) / step));

  const primary = points.map((p, i) => ({
    value: p.value,
    date: p.date,
    // only the last point gets a marker (the custom end dot below)
    hideDataPoint: i !== n - 1,
  }));
  const second = secondary?.map((v, i) => ({ value: v, date: points[i].date, hideDataPoint: true }));

  const endDot = (
    <View style={[styles.dotRing, { backgroundColor: c.primary, borderColor: c.surface }]} />
  );

  return (
    <View>
      <LineChart
        data={primary}
        data2={second}
        width={plotWidth}
        height={HEIGHT}
        spacing={spacing}
        initialSpacing={INITIAL_SPACING}
        endSpacing={END_SPACING}
        disableScroll
        adjustToWidth={false}
        // lines
        color1={c.primary}
        color2={c.other}
        thickness1={2}
        thickness2={2}
        // soft area wash under the primary series only
        areaChart1
        startFillColor1={c.primary}
        endFillColor1={c.primary}
        startOpacity1={0.1}
        endOpacity1={0.01}
        // end marker: one dot, 8px with a 2px surface ring
        customDataPoint={(_item: unknown, index: number) => (index === n - 1 ? endDot : null)}
        // axes: recessive, solid hairlines, compact ticks
        yAxisOffset={offset}
        maxValue={top - offset}
        stepValue={step}
        noOfSections={sections}
        yAxisLabelWidth={Y_LABEL_WIDTH}
        // the library already adds yAxisOffset to the tick labels it passes in
        formatYLabel={(v: string) => (mask ? money.compactCurrency(Number(v)) : formatCompactCurrency(Number(v)))}
        yAxisTextStyle={{ color: c.muted, fontSize: 11 }}
        yAxisColor="transparent"
        xAxisColor={c.axis}
        xAxisThickness={1}
        rulesType="solid"
        rulesColor={c.grid}
        rulesThickness={1}
        xAxisLabelTextStyle={{ color: c.muted, fontSize: 11 }}
        backgroundColor={c.surface}
        // touch tooltip; never the only way to read a value (axes + end label carry it)
        pointerConfig={{
          pointerStripColor: c.axis,
          pointerStripHeight: HEIGHT,
          pointerColor: c.primary,
          radius: 5,
          pointerLabelWidth: 132,
          pointerLabelHeight: secondary ? 74 : 56,
          autoAdjustPointerLabelPosition: true,
          pointerLabelComponent: (items: { date: string; value: number }[]) => (
            <View style={[styles.tip, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.tipDate, { color: c.inkSecondary }]}>{formatShortDate(items[0].date)}</Text>
              <Text style={[styles.tipValue, { color: c.ink }]}>
                {primaryName} {mask ? money.currency(items[0].value) : formatCurrency(items[0].value)}
              </Text>
              {secondary && items[1] ? (
                <Text style={[styles.tipValue, { color: c.ink }]}>
                  {secondaryName} {mask ? money.currency(items[1].value) : formatCurrency(items[1].value)}
                </Text>
              ) : null}
            </View>
          ),
        }}
      />

      <View style={styles.dates}>
        <Text style={[styles.dateText, { color: c.muted }]}>{formatShortDate(points[0].date)}</Text>
        <Text style={[styles.dateText, { color: c.muted }]}>{formatShortDate(points[n - 1].date)}</Text>
      </View>

      {secondary ? (
        <View style={styles.legend}>
          <LegendKey color={c.primary} label={primaryName} ink={c.inkSecondary} />
          <LegendKey color={c.other} label={secondaryName ?? ''} ink={c.inkSecondary} />
        </View>
      ) : null}
    </View>
  );
}

function LegendKey({ color, label, ink }: { color: string; label: string; ink: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: ink }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dotRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: -2, marginLeft: -2 },
  tip: { padding: Spacing.two, borderRadius: Spacing.two, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  tipDate: { fontSize: 11 },
  tipValue: { fontSize: 12, fontWeight: '600' },
  dates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: Y_LABEL_WIDTH + INITIAL_SPACING - 6,
    paddingRight: END_SPACING,
  },
  dateText: { fontSize: 11 },
  legend: { flexDirection: 'row', gap: Spacing.three, paddingTop: Spacing.three, paddingLeft: Y_LABEL_WIDTH },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: 12 },
});
