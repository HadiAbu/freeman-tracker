import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ChartCard } from '@/components/charts/chart-card';
import { TrendLine } from '@/components/charts/trend-line';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TradeRow } from '@/components/trade-row';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { usePriceHistory, useSaveHoldingMeta } from '@/hooks/use-portfolio';
import { usePortfolioSummary, useTickerTrades } from '@/hooks/use-trades';
import { haptic } from '@/lib/haptics';
import { formatCurrency, formatPercent, formatShares, formatSignedCurrency } from '@/lib/format';
import type { Holding } from '@/types';

function Stat({ label, value, color }: { label: string; value: string; color?: 'gain' | 'loss' }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" themeColor={color}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function HoldingScreen() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const router = useRouter();

  const summary = usePortfolioSummary();
  const trades = useTickerTrades(ticker);
  const prices = usePriceHistory(ticker);

  if (summary.isPending || trades.isPending) return <ThemedView style={styles.root}><LoadingState /></ThemedView>;
  if (summary.isError || trades.isError) {
    const error = (summary.error ?? trades.error) as Error;
    return (
      <ThemedView style={styles.root}>
        <ErrorState error={error} onRetry={() => { summary.refetch(); trades.refetch(); }} />
      </ThemedView>
    );
  }

  const holding = summary.data.holdings.find((h) => h.ticker === ticker);
  // already filtered by ticker on the server
  const mine = trades.data;

  // Price over time: what you paid at each trade plus any manual price marks.
  const points = [
    ...mine.map((t) => ({ date: t.traded_at, value: t.price })),
    ...(prices.data ?? []).map((p) => ({ date: p.as_of, value: p.price })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: ticker }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {holding ? <Position holding={holding} /> : (
          <ThemedText themeColor="textSecondary">
            {mine.length > 0 ? 'This position is closed.' : `No trades found for ${ticker}.`}
          </ThemedText>
        )}

        <Button
          title="Log price"
          variant="secondary"
          onPress={() => router.push({ pathname: '/log-price', params: { ticker } })}
        />

        <ChartCard title="Price" subtitle="Your trade prices and any price marks you have logged">
          <TrendLine
            points={points}
            primaryName="Price"
            emptyHint="Log a second trade or price mark to see the line."
          />
        </ChartCard>

        {holding ? <Classification holding={holding} /> : null}

        <ThemedText type="smallBold">Trades</ThemedText>
        {mine.map((t) => (
          <TradeRow key={t.id} trade={t} />
        ))}
      </ScrollView>
    </ThemedView>
  );
}

function Position({ holding: h }: { holding: Holding }) {
  const pnlColor = h.unrealized_pnl > 0 ? 'gain' : h.unrealized_pnl < 0 ? 'loss' : undefined;
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {h.name ? <ThemedText type="small" themeColor="textSecondary">{h.name}</ThemedText> : null}
      <ThemedText type="title" style={styles.value}>
        {formatCurrency(h.market_value)}
      </ThemedText>
      <ThemedText type="smallBold" themeColor={pnlColor}>
        {h.unrealized_pnl > 0 ? '▲ ' : h.unrealized_pnl < 0 ? '▼ ' : ''}
        {formatSignedCurrency(h.unrealized_pnl)} ({formatPercent(h.unrealized_pct)})
      </ThemedText>
      <View style={styles.stats}>
        <Stat label="Shares" value={formatShares(h.shares)} />
        <Stat label="Avg cost" value={formatCurrency(h.avg_cost)} />
        <Stat
          label={h.price_source === 'price' ? 'Price' : 'Last trade price'}
          value={formatCurrency(h.price)}
        />
        <Stat label="Cost basis" value={formatCurrency(h.cost_basis)} />
        <Stat
          label="Realized"
          value={formatSignedCurrency(h.realized_pnl)}
          color={h.realized_pnl > 0 ? 'gain' : h.realized_pnl < 0 ? 'loss' : undefined}
        />
      </View>
    </ThemedView>
  );
}

function Classification({ holding: h }: { holding: Holding }) {
  const save = useSaveHoldingMeta(h.ticker);
  const [name, setName] = useState(h.name ?? '');
  const [sector, setSector] = useState(h.sector ?? '');
  const [assetClass, setAssetClass] = useState(h.asset_class ?? '');

  const submit = () =>
    save.mutate(
      {
        name: name.trim() || null,
        sector: sector.trim() || null,
        asset_class: assetClass.trim() || null,
      },
      {
        onSuccess: () => haptic('success'),
        onError: () => haptic('error'),
      },
    );

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Classification</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Drives the Sector and Asset class views of your allocation.
      </ThemedText>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Apple Inc." />
      <TextField label="Sector" value={sector} onChangeText={setSector} placeholder="Technology" />
      <TextField label="Asset class" value={assetClass} onChangeText={setAssetClass} placeholder="Stock, ETF, Bond…" />
      {save.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {save.error.message}
        </ThemedText>
      ) : null}
      {save.isSuccess ? <ThemedText themeColor="gain">Saved</ThemedText> : null}
      <Button title="Save classification" onPress={submit} loading={save.isPending} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingBottom: Spacing.six,
  },
  card: { padding: Spacing.four, borderRadius: Spacing.four, gap: Spacing.two },
  value: { fontSize: 40, lineHeight: 48 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.two },
  stat: { minWidth: 96, gap: Spacing.half },
});
