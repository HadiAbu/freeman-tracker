import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { Spacing } from '@/constants/theme';
import { formatCurrency, formatPercent } from '@/lib/format';
import { isStalePrice, priceLabel } from '@/lib/price-label';
import type { WatchItem } from '@/types';

type Props = {
  item: WatchItem;
  onPress: (item: WatchItem) => void;
  onLongPress: (item: WatchItem) => void;
  onResearch?: (item: WatchItem) => void;
};

const PAUSED = 'paused until the price crosses back';

/** One line about the upper limit, in words (never color alone), or null when there is none. */
function upperLine(item: WatchItem): string | null {
  const { upper_limit: limit, upper_state: state, price, pct_to_target: pct } = item;
  if (limit === null) return null;
  const head = `Alert above ${formatCurrency(limit)}`;
  if (state === 'triggered') return `${head} · ${PAUSED}`;
  if (price === null) return `${head} · log a price to compare`;
  if (price >= limit) return `${head} · reached`;
  return `${head} · ${formatPercent(pct ?? 0)} to go`;
}

/** The same for the lower limit; how far the price could fall before it is reached. */
function lowerLine(item: WatchItem): string | null {
  const { lower_limit: limit, lower_state: state, price } = item;
  if (limit === null) return null;
  const head = `Alert below ${formatCurrency(limit)}`;
  if (state === 'triggered') return `${head} · ${PAUSED}`;
  if (price === null) return `${head} · log a price to compare`;
  if (price <= limit) return `${head} · reached`;
  return `${head} · ${formatPercent(-((price - limit) / price) * 100)} to go`;
}

function limitLines(item: WatchItem): string[] {
  const lines = [upperLine(item), lowerLine(item)].filter((l): l is string => l !== null);
  return lines.length > 0 ? lines : ['No alerts set'];
}

export function WatchRow({ item, onPress, onLongPress, onResearch }: Props) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.ticker}, tap to log a price, long press to remove`}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
      >
        <View style={styles.row}>
          <View style={styles.left}>
            <ThemedText type="smallBold">{item.ticker}</ThemedText>
            {item.name ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.name}
              </ThemedText>
            ) : null}
            {limitLines(item).map((line) => (
              <ThemedText key={line} type="small" themeColor="textSecondary">
                {line}
              </ThemedText>
            ))}
            {item.note ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.note}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.right}>
            <ThemedText type="smallBold">
              {item.price === null ? '—' : formatCurrency(item.price)}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor={isStalePrice(item.price_as_of) ? 'loss' : 'textSecondary'}
            >
              {priceLabel(item.price_kind, item.price_as_of)}
            </ThemedText>
          </View>
        </View>
      </Pressable>
      {/* A sibling of the row button, not a child: a button inside a button is invalid HTML on web. */}
      {onResearch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Research ${item.ticker} with news`}
          hitSlop={8}
          style={styles.research}
          onPress={() => onResearch(item)}
        >
          <ThemedText type="link">Research with news</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  research: { alignSelf: 'flex-start' },
  left: { flex: 1, gap: Spacing.half },
  right: { alignItems: 'flex-end', gap: Spacing.half },
});
