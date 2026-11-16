import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { AllocationDonut } from '@/components/charts/allocation-donut';
import { ChartCard, ChartNote } from '@/components/charts/chart-card';
import { TrendLine } from '@/components/charts/trend-line';
import { ChipRow } from '@/components/chip-row';
import { Screen } from '@/components/screen';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TradeRow } from '@/components/trade-row';
import { useChartTheme } from '@/constants/chart-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAllocation, usePortfolioHistory } from '@/hooks/use-portfolio';
import { usePortfolioSummary, useTrades } from '@/hooks/use-trades';
import { buildSlices, labelSlots, tickerOrder } from '@/lib/entity-colors';
import { formatCurrency, formatPercent, formatSignedCurrency } from '@/lib/format';
import type { AllocationBy } from '@/types';

const DIMENSIONS: { label: string; value: AllocationBy }[] = [
  { label: 'Ticker', value: 'ticker' },
  { label: 'Sector', value: 'sector' },
  { label: 'Asset class', value: 'asset_class' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const chart = useChartTheme();
  const [by, setBy] = useState<AllocationBy>('ticker');

  const summary = usePortfolioSummary();
  const trades = useTrades();
  const history = usePortfolioHistory();
  const allocation = useAllocation(by);

  const refreshing = summary.isRefetching || trades.isRefetching || history.isRefetching;
  const refresh = async () => {
    await Promise.all([summary.refetch(), trades.refetch(), history.refetch(), allocation.refetch()]);
  };

  if (summary.isPending) return <Screen><LoadingState /></Screen>;
  if (summary.isError) {
    return <Screen><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></Screen>;
  }

  const s = summary.data;
  const pnlColor = s.unrealized_pnl > 0 ? 'gain' : s.unrealized_pnl < 0 ? 'loss' : 'textSecondary';
  const recent = trades.data?.slice(0, 5) ?? [];

  const slices =
    allocation.data && trades.data
      ? buildSlices(
          allocation.data,
          labelSlots(by, s.holdings, tickerOrder(trades.data)),
          chart.categorical,
          chart.other,
        )
      : [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <ThemedText type="subtitle">Dashboard</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Portfolio value
          </ThemedText>
          <ThemedText type="title" style={styles.value}>
            {formatCurrency(s.total_value)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={pnlColor}>
            {formatSignedCurrency(s.unrealized_pnl)} ({formatPercent(s.unrealized_pct)}) unrealized
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Cost {formatCurrency(s.total_cost)} · Realized {formatSignedCurrency(s.realized_pnl)}
          </ThemedText>
        </ThemedView>

        <ChartCard title="Value over time" subtitle="Portfolio value against what you paid">
          {history.isError ? (
            <ChartNote>{history.error.message}</ChartNote>
          ) : history.isPending ? (
            <LoadingState />
          ) : (
            <TrendLine
              points={history.data.map((p) => ({ date: p.date, value: p.value }))}
              secondary={history.data.map((p) => p.cost)}
              primaryName="Value"
              secondaryName="Cost basis"
              emptyHint="The line appears once you have activity on two different dates."
            />
          )}
        </ChartCard>

        {/* One filter row above the chart it scopes, outside the card */}
        <View style={styles.filterRow}>
          <ThemedText type="smallBold">Allocation by</ThemedText>
          <ChipRow options={DIMENSIONS} value={by} onChange={setBy} />
        </View>

        <ChartCard
          title="Allocation"
          subtitle={DIMENSIONS.find((d) => d.value === by)?.label}
          summary={slices.map((x) => `${x.label} ${x.percent.toFixed(1)} percent`).join(', ')}>
          {allocation.isError ? (
            <ChartNote>{allocation.error.message}</ChartNote>
          ) : slices.length === 0 ? (
            allocation.isPending || trades.isPending ? <LoadingState /> : <ChartNote>No open positions to show yet.</ChartNote>
          ) : (
            <AllocationDonut slices={slices} total={s.total_value} />
          )}
        </ChartCard>

        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold">Recent trades</ThemedText>
          <Button title="Add trade" onPress={() => router.push('/add-trade')} />
        </View>

        {recent.length === 0 ? (
          <ThemedText themeColor="textSecondary">No trades yet. Add your first buy to see your portfolio here.</ThemedText>
        ) : (
          recent.map((t) => <TradeRow key={t.id} trade={t} />)
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingVertical: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
  card: { padding: Spacing.four, borderRadius: Spacing.four, gap: Spacing.one },
  value: { fontSize: 40, lineHeight: 48 },
  filterRow: { gap: Spacing.two, marginTop: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
});
