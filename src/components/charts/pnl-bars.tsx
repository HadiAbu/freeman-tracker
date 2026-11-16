import React from 'react';
import { BarChart } from 'react-native-gifted-charts';

import { ChartNote } from '@/components/charts/chart-card';
import { useChartTheme } from '@/constants/chart-theme';
import { useChartWidth } from '@/hooks/use-chart-width';
import { formatCompactCurrency, niceStep } from '@/lib/format';
import type { Holding } from '@/types';

const Y_LABEL_WIDTH = 52;
const MAX_BARS = 10;
const BAR_WIDTH = 24; // marks stay thin: never fill the slot
const HEIGHT = 160;

/**
 * Unrealized P&L per holding, bars above/below a single zero baseline. Direction is
 * carried by position relative to the baseline, so green/red is never the only cue.
 * The holdings list under the chart is the table view for every value.
 */
export function PnLBars({ holdings }: { holdings: Holding[] }) {
  const c = useChartTheme();
  const width = useChartWidth();

  if (holdings.length === 0) return <ChartNote>No open positions yet.</ChartNote>;

  const shown = [...holdings]
    .sort((a, b) => Math.abs(b.unrealized_pnl) - Math.abs(a.unrealized_pnl))
    .slice(0, MAX_BARS)
    .sort((a, b) => b.unrealized_pnl - a.unrealized_pnl);

  const maxPos = Math.max(0, ...shown.map((h) => h.unrealized_pnl));
  const maxNeg = Math.max(0, ...shown.map((h) => -h.unrealized_pnl));
  if (maxPos === 0 && maxNeg === 0) return <ChartNote>No gains or losses yet: every position is at cost.</ChartNote>;

  const step = niceStep(Math.max(maxPos, maxNeg) / 2);
  const posSections = Math.max(1, Math.ceil(maxPos / step));
  const negSections = Math.ceil(maxNeg / step);

  // BarChart's `width` also covers the y-axis labels, unlike LineChart's, so budget for both.
  const plotWidth = width - Y_LABEL_WIDTH - 24;
  const spacing = Math.max(12, Math.min(48, (plotWidth - 24) / shown.length - BAR_WIDTH));

  const data = shown.map((h) => {
    const gain = h.unrealized_pnl >= 0;
    return {
      value: h.unrealized_pnl,
      label: h.ticker,
      frontColor: gain ? c.good : c.critical,
      // 4px rounded data-end, square where the bar meets the baseline
      barBorderTopLeftRadius: gain ? 4 : 0,
      barBorderTopRightRadius: gain ? 4 : 0,
      barBorderBottomLeftRadius: gain ? 0 : 4,
      barBorderBottomRightRadius: gain ? 0 : 4,
    };
  });

  return (
    <BarChart
      data={data}
      width={plotWidth}
      height={HEIGHT}
      barWidth={BAR_WIDTH}
      spacing={spacing}
      initialSpacing={12}
      endSpacing={12}
      disableScroll
      adjustToWidth={false}
      isAnimated={false}
      backgroundColor={c.surface}
      stepValue={step}
      noOfSections={posSections}
      maxValue={posSections * step}
      noOfSectionsBelowXAxis={negSections}
      mostNegativeValue={-negSections * step}
      negativeStepValue={step}
      yAxisLabelWidth={Y_LABEL_WIDTH}
      formatYLabel={(v: string) => formatCompactCurrency(Number(v))}
      yAxisTextStyle={{ color: c.muted, fontSize: 11 }}
      yAxisColor="transparent"
      xAxisColor={c.axis}
      xAxisThickness={1}
      rulesType="solid"
      rulesColor={c.grid}
      rulesThickness={1}
      // ticker labels go under the whole plot so negative bars never sit on top of them
      xAxisLabelsAtBottom
      xAxisLabelTextStyle={{ color: c.inkSecondary, fontSize: 11, textAlign: 'center' }}
    />
  );
}
