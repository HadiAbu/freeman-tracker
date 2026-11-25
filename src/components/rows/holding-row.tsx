import { Link } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { Spacing } from '@/constants/theme';
import { useMoney } from '@/hooks/use-money';
import { formatPercent } from '@/lib/format';
import { isStalePrice, priceLabel } from '@/lib/price-label';
import type { Holding } from '@/types';

export function HoldingRow({ holding: h }: { holding: Holding }) {
  const money = useMoney();
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
              {money.shares(h.shares)} @ {money.currency(h.avg_cost)}
            </ThemedText>
            {/* where the price came from and how old it is, in words */}
            <ThemedText
              type="small"
              themeColor={isStalePrice(h.price_as_of) ? 'loss' : 'textSecondary'}
            >
              {priceLabel(h.price_kind, h.price_as_of)}
            </ThemedText>
          </View>
          <View style={styles.right}>
            <ThemedText type="smallBold">{money.currency(h.market_value)}</ThemedText>
            {/* arrow + sign + color: the direction never relies on color alone */}
            <ThemedText type="small" themeColor={color}>
              {arrow} {money.signedCurrency(h.unrealized_pnl)} ({formatPercent(h.unrealized_pct)})
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
