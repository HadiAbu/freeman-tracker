import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { Spacing } from '@/constants/theme';
import { useMoney } from '@/hooks/use-money';
import { formatCurrency } from '@/lib/format';
import type { Trade } from '@/types';

type Props = { trade: Trade; onLongPress?: (trade: Trade) => void };

// memo: a list of these should only redraw the rows whose trade (or handler) actually changed.
export const TradeRow = React.memo(function TradeRow({ trade, onLongPress }: Props) {
  const money = useMoney();
  const buy = trade.side === 'buy';
  const total = trade.shares * trade.price + (buy ? trade.fee : -trade.fee);

  return (
    <Pressable
      accessibilityHint={onLongPress ? 'Long press to delete' : undefined}
      onLongPress={onLongPress ? () => onLongPress(trade) : undefined}
    >
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.left}>
          <View style={styles.titleLine}>
            <ThemedText type="smallBold">{trade.ticker}</ThemedText>
            <ThemedText type="smallBold" themeColor={buy ? 'gain' : 'loss'}>
              {buy ? 'BUY' : 'SELL'}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {money.shares(trade.shares)} × {formatCurrency(trade.price)} · {trade.traded_at}
          </ThemedText>
          {trade.note ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {trade.note}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="smallBold">{money.currency(total)}</ThemedText>
      </ThemedView>
    </Pressable>
  );
});

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
  titleLine: { flexDirection: 'row', gap: Spacing.two },
});
