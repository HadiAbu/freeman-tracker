import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatCurrency, formatPercent } from '@/lib/format';
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.ticker}, tap to log a price, long press to remove`}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}>
      <ThemedView type="backgroundElement" style={styles.row}>
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
          {onResearch ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Research ${item.ticker} with news`}
              hitSlop={8}
              onPress={() => onResearch(item)}>
              <ThemedText type="link">Research with news</ThemedText>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.right}>
          <ThemedText type="smallBold">{item.price === null ? '—' : formatCurrency(item.price)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.price === null ? 'no price yet' : 'last price'}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  left: { flex: 1, gap: Spacing.half },
  right: { alignItems: 'flex-end', gap: Spacing.half },
});
