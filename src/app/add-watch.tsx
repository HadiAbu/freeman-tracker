import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAddWatch } from '@/hooks/use-watchlist';

type Errors = Partial<Record<'ticker' | 'target', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));

export default function AddWatchScreen() {
  const router = useRouter();
  const add = useAddWatch();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/watchlist'));

  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker, e.g. NVDA';
    if (target.trim() !== '' && !(num(target) >= 0)) e.target = 'Target must be 0 or more';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    add.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        name: name.trim() || null,
        target_price: target.trim() === '' ? null : num(target),
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          close();
        },
        onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
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
            placeholder="NVDA"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <TextField label="Name (optional)" value={name} onChangeText={setName} placeholder="NVIDIA" />
          <TextField
            label="Target price (optional)"
            error={errors.target}
            value={target}
            onChangeText={setTarget}
            placeholder="500"
            keyboardType="decimal-pad"
          />
          <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Why are you watching it?" />
          <ThemedText type="small" themeColor="textSecondary">
            Adding a ticker that is already on the list updates its target and note.
          </ThemedText>

          {add.isError ? (
            <ThemedText themeColor="loss" accessibilityRole="alert">
              {add.error.message}
            </ThemedText>
          ) : null}

          <Button title="Save" onPress={submit} loading={add.isPending} />
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
