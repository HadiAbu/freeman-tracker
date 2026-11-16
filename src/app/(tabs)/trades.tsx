import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TradeRow } from '@/components/trade-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useDeleteTrade, useTrades } from '@/hooks/use-trades';
import type { Side, Trade } from '@/types';

const FILTERS: { label: string; value: Side | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Buys', value: 'buy' },
  { label: 'Sells', value: 'sell' },
];

function confirmDelete(trade: Trade, onConfirm: () => void) {
  const message = `${trade.side.toUpperCase()} ${trade.shares} ${trade.ticker} on ${trade.traded_at}`;
  if (Platform.OS === 'web') {
    if (window.confirm(`Delete trade?\n${message}`)) onConfirm();
    return;
  }
  Alert.alert('Delete trade?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function TradesScreen() {
  const router = useRouter();
  const [side, setSide] = useState<Side | undefined>(undefined);
  const trades = useTrades(side);
  const remove = useDeleteTrade();

  const onDelete = (trade: Trade) =>
    confirmDelete(trade, () =>
      remove.mutate(trade.id, {
        onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        onError: (e) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          // e.g. 409: deleting a buy that a later sell depends on
          Alert.alert('Could not delete trade', e.message);
        },
      }),
    );

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
              onPress={() => setSide(f.value)}>
              <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.pill}>
                <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                  {f.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>

      {trades.isPending ? (
        <LoadingState />
      ) : trades.isError ? (
        <ErrorState error={trades.error} onRetry={() => trades.refetch()} />
      ) : (
        <FlatList
          data={trades.data}
          keyExtractor={(t) => String(t.id)}
          renderItem={({ item }) => <TradeRow trade={item} onLongPress={onDelete} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState title="No trades yet" hint="Tap “Add trade” to log your first buy or sell." />
          }
          refreshing={trades.isRefetching}
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
  pill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  list: { flexGrow: 1, paddingBottom: BottomTabInset + Spacing.four },
  separator: { height: Spacing.two },
});
