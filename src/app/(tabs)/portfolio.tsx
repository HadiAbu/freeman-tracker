import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ChartCard } from '@/components/charts/chart-card';
import { PnLBars } from '@/components/charts/pnl-bars';
import { HoldingRow } from '@/components/holding-row';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { usePortfolioSummary } from '@/hooks/use-trades';
import { formatCurrency, formatSignedCurrency } from '@/lib/format';

export default function PortfolioScreen() {
  const summary = usePortfolioSummary();

  if (summary.isPending) return <Screen><LoadingState /></Screen>;
  if (summary.isError) {
    return <Screen><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></Screen>;
  }

  const { holdings } = summary.data;
  if (holdings.length === 0) {
    return (
      <Screen>
        <EmptyState title="No holdings yet" hint="Add a buy on the Trades tab and your positions will show up here." />
      </Screen>
    );
  }

  const chartSummary = holdings
    .map((h) => `${h.ticker} ${formatSignedCurrency(h.unrealized_pnl)}`)
    .join(', ');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={async () => { await summary.refetch(); }} />}>
        <ThemedText type="subtitle">Portfolio</ThemedText>

        <ChartCard
          title="Unrealized gain / loss"
          subtitle={holdings.length > 10 ? 'Ten largest moves' : 'By holding, versus cost'}
          summary={chartSummary}>
          <PnLBars holdings={holdings} />
        </ChartCard>

        <View style={styles.listHeader}>
          <ThemedText type="smallBold">Holdings</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatCurrency(summary.data.total_value)}
          </ThemedText>
        </View>
        {holdings.map((h) => (
          <HoldingRow key={h.ticker} holding={h} />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingVertical: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two },
});
