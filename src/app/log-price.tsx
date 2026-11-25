import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAddPrice } from '@/hooks/use-watchlist';
import { haptic } from '@/lib/haptics';
import { isISODate, todayISO } from '@/lib/format';

type Errors = Partial<Record<'ticker' | 'price' | 'date', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));

/** Log a manual price mark for a ticker. Revalues holdings and the watchlist. */
export default function LogPriceScreen() {
  const { ticker: param } = useLocalSearchParams<{ ticker?: string }>();
  const router = useRouter();
  const addPrice = useAddPrice();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const [ticker, setTicker] = useState(String(param ?? '').toUpperCase());
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(todayISO());
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker';
    if (price.trim() === '' || !(num(price) > 0)) e.price = 'Price must be greater than 0';
    if (!isISODate(date.trim())) e.date = 'Use the format YYYY-MM-DD';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      haptic('warning');
      return;
    }
    addPrice.mutate(
      { ticker: ticker.trim().toUpperCase(), price: num(price), as_of: date.trim() },
      {
        onSuccess: () => {
          haptic('success');
          close();
        },
        onError: () => haptic('error'),
      },
    );
  }

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextField
            label="Ticker"
            error={errors.ticker}
            value={ticker}
            onChangeText={setTicker}
            editable={!param}
            placeholder="AAPL"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <TextField
            label="Price (USD)"
            error={errors.price}
            value={price}
            onChangeText={setPrice}
            placeholder="189.50"
            keyboardType="decimal-pad"
            autoFocus
          />
          <TextField
            label="As of"
            error={errors.date}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <ThemedText type="small" themeColor="textSecondary">
            The newest price for a ticker values your position and drives its gain or loss.
          </ThemedText>

          {addPrice.isError ? (
            <ThemedText themeColor="loss" accessibilityRole="alert">
              {addPrice.error.message}
            </ThemedText>
          ) : null}

          <Button title="Save price" onPress={submit} loading={addPrice.isPending} />
          <Button title="Cancel" variant="secondary" onPress={close} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
