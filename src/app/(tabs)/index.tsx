import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { AllocationDonut } from '@/components/charts/allocation-donut';
import { ChartCard, ChartNote } from '@/components/charts/chart-card';
import { TrendLine } from '@/components/charts/trend-line';
import { ChipRow } from '@/components/chip-row';
import { ErrorBanner } from '@/components/error-banner';
import { PrivacyToggle } from '@/components/privacy-toggle';
import { Screen } from '@/components/screen';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TradeRow } from '@/components/trade-row';
import { useChartTheme } from '@/constants/chart-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useMoney } from '@/hooks/use-money';
import { useAllocation, usePortfolioHistory } from '@/hooks/use-portfolio';
import { usePortfolioSummary, useRecentTrades } from '@/hooks/use-trades';
import { isAllUnassigned } from '@/lib/classification';
import { buildSlices } from '@/lib/entity-colors';
import { formatPercent } from '@/lib/format';
import { usePreferences } from '@/stores/preferences';
import type { AllocationBy } from '@/types';

const DIMENSIONS: { label: string; value: AllocationBy }[] = [
  { label: 'Ticker', value: 'ticker' },
  { label: 'Sector', value: 'sector' },
  { label: 'Asset class', value: 'asset_class' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const chart = useChartTheme();
  const money = useMoney();
  // remembered between launches
  const by = usePreferences((s) => s.allocationBy);
  const setBy = usePreferences((s) => s.setAllocationBy);

  const summary = usePortfolioSummary();
  const trades = useRecentTrades(5);
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
  // Slot (identity) comes from the server, so colors depend only on the slice, never on the
  // selected dimension or on how many trades happen to be loaded.
  const slices = allocation.data
    ? buildSlices(allocation.data, chart.categorical, chart.other)
    : [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle">Dashboard</ThemedText>
          <PrivacyToggle />
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Portfolio value
          </ThemedText>
          <ThemedText type="title" style={styles.value}>
            {money.currency(s.total_value)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={pnlColor}>
            {money.signedCurrency(s.unrealized_pnl)} ({formatPercent(s.unrealized_pct)}) unrealized
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Cost {money.currency(s.total_cost)} · Realized {money.signedCurrency(s.realized_pnl)}
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
              sensitive
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
            allocation.isPending ? <LoadingState /> : <ChartNote>No open positions to show yet.</ChartNote>
          ) : by !== 'ticker' && !allocation.isPlaceholderData && isAllUnassigned(slices) ? (
            <ChartNote>
              {`None of your positions has a ${by === 'sector' ? 'sector' : 'asset class'} yet. Set it when you add a trade, or on a position's screen under Classification, to group by it. Use Ticker to see your allocation now.`}
            </ChartNote>
          ) : (
            // key resets the focused slice when the dimension changes
            <AllocationDonut key={by} slices={slices} total={s.total_value} />
          )}
        </ChartCard>

        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold">Recent trades</ThemedText>
          <Button title="Add trade" onPress={() => router.push('/add-trade')} />
        </View>

        {trades.isError ? (
          // a failed request must not read as "no trades"
          <ErrorBanner message={trades.error.message} onDismiss={() => trades.refetch()} actionLabel="Retry" />
        ) : trades.isPending ? (
          <LoadingState />
        ) : trades.data.length === 0 ? (
          <ThemedText themeColor="textSecondary">No trades yet. Add your first buy to see your portfolio here.</ThemedText>
        ) : (
          trades.data.map((t) => <TradeRow key={t.id} trade={t} />)
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingVertical: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { padding: Spacing.four, borderRadius: Spacing.four, gap: Spacing.one },
  value: { fontSize: 40, lineHeight: 48 },
  filterRow: { gap: Spacing.two, marginTop: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
});
