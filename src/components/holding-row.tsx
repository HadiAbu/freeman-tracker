import { Link } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatCurrency, formatPercent, formatShares, formatSignedCurrency } from '@/lib/format';
import type { Holding } from '@/types';

export function HoldingRow({ holding: h }: { holding: Holding }) {
  const color = h.unrealized_pnl > 0 ? 'gain' : h.unrealized_pnl < 0 ? 'loss' : 'textSecondary';
  const arrow = h.unrealized_pnl > 0 ? '▲' : h.unrealized_pnl < 0 ? '▼' : '';

  return (
    <Link href={{ pathname: '/holding/[ticker]', params: { ticker: h.ticker } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${h.ticker} position details`}>
        <ThemedView type="backgroundElement" style={styles.row}>
          <View style={styles.left}>
            <ThemedText type="smallBold">{h.ticker}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {h.name ? `${h.name} · ` : ''}
              {formatShares(h.shares)} @ {formatCurrency(h.avg_cost)}
            </ThemedText>
          </View>
          <View style={styles.right}>
            <ThemedText type="smallBold">{formatCurrency(h.market_value)}</ThemedText>
            {/* arrow + sign + color: the direction never relies on color alone */}
            <ThemedText type="small" themeColor={color}>
              {arrow} {formatSignedCurrency(h.unrealized_pnl)} ({formatPercent(h.unrealized_pct)})
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    </Link>
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
