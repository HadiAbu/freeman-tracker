import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/feedback/error-banner';
import { Screen } from '@/components/layout/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/screen-state';
import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { TradeRow } from '@/components/rows/trade-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useDeleteTrade, useTradePages } from '@/hooks/use-trades';
import { haptic } from '@/lib/haptics';
import { confirmDestructive } from '@/lib/confirm';
import { usePreferences } from '@/stores/preferences';
import type { Side, Trade } from '@/types';

const FILTERS: { label: string; value: Side | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Buys', value: 'buy' },
  { label: 'Sells', value: 'sell' },
];

function confirmDelete(trade: Trade, onConfirm: () => void) {
  const message = `${trade.side.toUpperCase()} ${trade.shares} ${trade.ticker} on ${trade.traded_at}`;
  confirmDestructive('Delete trade?', message, 'Delete', onConfirm);
}

function Separator() {
  return <View style={styles.separator} />;
}

export default function TradesScreen() {
  const router = useRouter();
  // remembered between launches (null is "All")
  const savedSide = usePreferences((s) => s.tradesSide);
  const setSavedSide = usePreferences((s) => s.setTradesSide);
  const side: Side | undefined = savedSide ?? undefined;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const trades = useTradePages(side);
  const { mutate: removeTrade } = useDeleteTrade();

  const items = trades.data?.pages.flat() ?? [];

  // Stable identity, so memoized rows are not redrawn every time this screen updates.
  const onDelete = useCallback(
    (trade: Trade) =>
      confirmDelete(trade, () => {
        setDeleteError(null);
        removeTrade(trade.id, {
          onSuccess: () => haptic('success'),
          onError: (e) => {
            haptic('error');
            // e.g. 409: deleting a buy that a later sell depends on
            setDeleteError(e.message);
          },
        });
      }),
    [removeTrade],
  );

  const renderItem = useCallback(
    ({ item }: { item: Trade }) => <TradeRow trade={item} onLongPress={onDelete} />,
    [onDelete],
  );

  const loadMore = () => {
    if (trades.hasNextPage && !trades.isFetchingNextPage) trades.fetchNextPage();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Trades</ThemedText>
        <Button title="Add trade" onPress={() => router.push('/add-trade')} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = f.value === side;
          return (
            <Pressable
              key={f.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setSavedSide(f.value ?? null)}
            >
              <ThemedView
                type={active ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.pill}
              >
                <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                  {f.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>

      {deleteError ? (
        <View style={styles.banner}>
          <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} />
        </View>
      ) : null}

      {trades.isPending ? (
        <LoadingState />
      ) : trades.isError ? (
        <ErrorState error={trades.error} onRetry={() => trades.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => String(t.id)}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState
              title="No trades yet"
              hint="Tap “Add trade” to log your first buy or sell."
            />
          }
          ListFooterComponent={
            trades.hasNextPage ? (
              <View style={styles.footer}>
                {trades.isFetchingNextPage ? (
                  <ActivityIndicator />
                ) : (
                  <Button title="Load older trades" variant="secondary" onPress={loadMore} />
                )}
              </View>
            ) : undefined
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshing={trades.isRefetching && !trades.isFetchingNextPage}
          onRefresh={() => trades.refetch()}
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
  },
  filters: { flexDirection: 'row', gap: Spacing.two, paddingBottom: Spacing.three },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  banner: { paddingBottom: Spacing.three },
  list: { flexGrow: 1, paddingBottom: BottomTabInset + Spacing.four },
  separator: { height: Spacing.two },
  footer: { paddingVertical: Spacing.three, alignItems: 'center' },
});
