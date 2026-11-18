import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSaveHoldingMeta } from '@/hooks/use-portfolio';
import { useCreateTrade, usePortfolioSummary } from '@/hooks/use-trades';
import { useTheme } from '@/hooks/use-theme';
import { mergeClassification } from '@/lib/classification';
import { haptic } from '@/lib/haptics';
import { isISODate, todayISO } from '@/lib/format';
import type { Side } from '@/types';

type Errors = Partial<Record<'ticker' | 'shares' | 'price' | 'fee' | 'date', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));

export default function AddTradeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const create = useCreateTrade();

  // Opened via deep link / page reload there is no history to go back to.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const [side, setSide] = useState<Side>('buy');
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [sector, setSector] = useState('');
  const [assetClass, setAssetClass] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const summary = usePortfolioSummary();
  const saveMeta = useSaveHoldingMeta(ticker.trim().toUpperCase());

  function validate(): Errors {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker, e.g. AAPL';
    if (!(num(shares) > 0)) e.shares = 'Shares must be greater than 0';
    if (price.trim() === '' || !(num(price) >= 0)) e.price = 'Enter a price (0 or more)';
    if (fee.trim() !== '' && !(num(fee) >= 0)) e.fee = 'Fee must be 0 or more';
    if (!isISODate(date.trim())) e.date = 'Use the format YYYY-MM-DD';
    return e;
  }

  function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      haptic('warning');
      return;
    }
    create.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        side,
        shares: num(shares),
        price: num(price),
        fee: fee.trim() === '' ? 0 : num(fee),
        traded_at: date.trim(),
        note: note.trim() || null,
      },
      {
        onSuccess: async () => {
          // Best effort: the trade is already saved, so a failed classification must not block
          // closing. It can be set later on the position screen.
          const upper = ticker.trim().toUpperCase();
          const meta = mergeClassification(
            summary.data?.holdings.find((h) => h.ticker === upper),
            { sector, assetClass },
          );
          let metaFailed = false;
          if (meta) {
            try {
              await saveMeta.mutateAsync(meta);
            } catch {
              metaFailed = true;
            }
          }
          haptic(metaFailed ? 'warning' : 'success');
          close();
        },
        onError: () => haptic('error'),
      },
    );
  }

  const input = [styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border }];

  const field = (
    label: string,
    key: keyof Errors | null,
    props: React.ComponentProps<typeof TextInput>,
  ) => (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={input}
        accessibilityLabel={label}
        {...props}
      />
      {key && errors[key] ? (
        <ThemedText type="small" themeColor="loss">
          {errors[key]}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.sides}>
            {(['buy', 'sell'] as const).map((s) => {
              const active = side === s;
              return (
                <Pressable
                  key={s}
                  style={styles.sideFlex}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSide(s)}>
                  <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.sideBtn}>
                    <ThemedText type="smallBold" themeColor={active ? (s === 'buy' ? 'gain' : 'loss') : 'textSecondary'}>
                      {s === 'buy' ? 'Buy' : 'Sell'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>

          {field('Ticker', 'ticker', {
            value: ticker,
            onChangeText: setTicker,
            placeholder: 'AAPL',
            autoCapitalize: 'characters',
            autoCorrect: false,
          })}
          {field('Shares', 'shares', {
            value: shares,
            onChangeText: setShares,
            placeholder: '10',
            keyboardType: 'decimal-pad',
          })}
          {field('Price per share (USD)', 'price', {
            value: price,
            onChangeText: setPrice,
            placeholder: '189.50',
            keyboardType: 'decimal-pad',
          })}
          {field('Fee (optional)', 'fee', {
            value: fee,
            onChangeText: setFee,
            placeholder: '0',
            keyboardType: 'decimal-pad',
          })}
          {field('Date', 'date', {
            value: date,
            onChangeText: setDate,
            placeholder: 'YYYY-MM-DD',
            autoCorrect: false,
            autoCapitalize: 'none',
          })}
          {field('Note (optional)', null, { value: note, onChangeText: setNote, placeholder: 'Why this trade?' })}
          {field('Sector (optional)', null, {
            value: sector,
            onChangeText: setSector,
            placeholder: 'Technology',
          })}
          {field('Asset class (optional)', null, {
            value: assetClass,
            onChangeText: setAssetClass,
            placeholder: 'Stock, ETF, Bond…',
          })}

          {create.isError ? (
            <ThemedText themeColor="loss" accessibilityRole="alert">
              {create.error.message}
            </ThemedText>
          ) : null}

          <Button title="Save trade" onPress={submit} loading={create.isPending} />
          <Button title="Cancel" variant="secondary" onPress={close} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  sides: { flexDirection: 'row', gap: Spacing.two },
  sideFlex: { flex: 1 },
  sideBtn: { minHeight: 44, borderRadius: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  field: { gap: Spacing.one },
  input: { minHeight: 48, borderRadius: Spacing.three, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, fontSize: 16 },
});
