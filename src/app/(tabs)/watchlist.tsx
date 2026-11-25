import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/feedback/error-banner';
import { PriceUpdated } from '@/components/prices/price-updated';
import { ResearchBox } from '@/components/analysis/research-box';
import { Screen } from '@/components/layout/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/screen-state';
import { ThemedText } from '@/components/ui/themed-text';
import { WatchRow } from '@/components/rows/watch-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useRefreshPrices } from '@/hooks/use-market-prices';
import { useDeleteWatch, useWatchlist } from '@/hooks/use-watchlist';
import { haptic } from '@/lib/haptics';
import { confirmDestructive } from '@/lib/confirm';
import type { WatchItem } from '@/types';

export default function WatchlistScreen() {
  const router = useRouter();
  const { mutateAsync: refreshPrices, isPending: refreshingPrices } = useRefreshPrices();
  const watchlist = useWatchlist();
  const remove = useDeleteWatch();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const onRemove = (item: WatchItem) =>
    confirmDestructive('Remove from watchlist?', item.ticker, 'Remove', () => {
      setRemoveError(null);
      remove.mutate(item.id, {
        onSuccess: () => haptic('success'),
        onError: (e) => {
          haptic('error');
          setRemoveError(e.message);
        },
      });
    });

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Watchlist</ThemedText>
        <Button title="Add ticker" onPress={() => router.push('/add-watch')} />
      </View>

      <View style={styles.priceNote}>
        <PriceUpdated />
      </View>

      <View style={styles.researchBox}>
        <ResearchBox
          onSubmit={(t) => router.push({ pathname: '/analysis/[ticker]', params: { ticker: t } })}
        />
      </View>

      {removeError ? (
        <View style={styles.banner}>
          <ErrorBanner message={removeError} onDismiss={() => setRemoveError(null)} />
        </View>
      ) : null}

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
              onResearch={(w) =>
                router.push({ pathname: '/analysis/[ticker]', params: { ticker: w.ticker } })
              }
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
          refreshing={refreshingPrices || watchlist.isRefetching}
          onRefresh={async () => {
            await refreshPrices().catch(() => undefined); // keeps the old prices on failure
            await watchlist.refetch();
          }}
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
  priceNote: { paddingHorizontal: Spacing.three },
  researchBox: { paddingBottom: Spacing.three },
  banner: { paddingBottom: Spacing.three },
  list: { flexGrow: 1, paddingBottom: BottomTabInset + Spacing.four },
  separator: { height: Spacing.two },
  hint: { textAlign: 'center', paddingTop: Spacing.three },
});
