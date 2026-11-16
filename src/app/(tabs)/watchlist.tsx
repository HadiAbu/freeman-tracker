import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-state';
import { ThemedText } from '@/components/themed-text';
import { WatchRow } from '@/components/watch-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useDeleteWatch, useWatchlist } from '@/hooks/use-watchlist';
import { confirmDestructive } from '@/lib/confirm';
import type { WatchItem } from '@/types';

export default function WatchlistScreen() {
  const router = useRouter();
  const watchlist = useWatchlist();
  const remove = useDeleteWatch();

  const onRemove = (item: WatchItem) =>
    confirmDestructive('Remove from watchlist?', item.ticker, 'Remove', () =>
      remove.mutate(item.id, {
        onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        onError: (e) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Could not remove', e.message);
        },
      }),
    );

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Watchlist</ThemedText>
        <Button title="Add ticker" onPress={() => router.push('/add-watch')} />
      </View>

      {watchlist.isPending ? (
        <LoadingState />
      ) : watchlist.isError ? (
        <ErrorState error={watchlist.error} onRetry={() => watchlist.refetch()} />
      ) : (
        <FlatList
          data={watchlist.data}
          keyExtractor={(w) => String(w.id)}
          renderItem={({ item }) => (
            <WatchRow
              item={item}
              onPress={(w) => router.push({ pathname: '/log-price', params: { ticker: w.ticker } })}
              onLongPress={onRemove}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState
              title="Nothing on your watchlist"
              hint="Add a ticker you are following, set a target price, and log prices to see how far it is from target."
            />
          }
          ListFooterComponent={
            watchlist.data.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                Tap a ticker to log its price. Long press to remove it.
              </ThemedText>
            ) : undefined
          }
          refreshing={watchlist.isRefetching}
          onRefresh={() => watchlist.refetch()}
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
  list: { flexGrow: 1, paddingBottom: BottomTabInset + Spacing.four },
  separator: { height: Spacing.two },
  hint: { textAlign: 'center', paddingTop: Spacing.three },
});
