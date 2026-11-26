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

/** What the target means right now, in words as well as color. */
function targetStatus(item: WatchItem): { text: string; color?: 'gain' } {
  const { price, target_price: target, pct_to_target: pct } = item;
  if (target === null) return { text: 'No target set' };
  if (price === null) return { text: `Target ${formatCurrency(target)} · log a price to compare` };
  if (price >= target) return { text: `Target ${formatCurrency(target)} reached`, color: 'gain' };
  return { text: `Target ${formatCurrency(target)} · ${formatPercent(pct ?? 0)} to go` };
}

export function WatchRow({ item, onPress, onLongPress, onResearch }: Props) {
  const status = targetStatus(item);
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
            <ThemedText type="small" themeColor={status.color ?? 'textSecondary'}>
              {status.color ? '✓ ' : ''}
              {status.text}
            </ThemedText>
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
