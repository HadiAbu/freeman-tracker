import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TradeRow } from '@/components/trade-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { usePortfolioSummary, useTrades } from '@/hooks/use-trades';
import { formatCurrency, formatPercent, formatSignedCurrency } from '@/lib/format';

export default function DashboardScreen() {
  const router = useRouter();
  const summary = usePortfolioSummary();
  const trades = useTrades();

  const refreshing = summary.isRefetching || trades.isRefetching;
  const refresh = async () => {
    await Promise.all([summary.refetch(), trades.refetch()]);
  };

  if (summary.isPending) return <Screen><LoadingState /></Screen>;
  if (summary.isError) {
    return <Screen><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></Screen>;
  }

  const s = summary.data;
  const pnlColor = s.unrealized_pnl > 0 ? 'gain' : s.unrealized_pnl < 0 ? 'loss' : 'textSecondary';
  const recent = trades.data?.slice(0, 5) ?? [];

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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
