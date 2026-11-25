import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import { ScrollScreen } from '@/components/layout/scroll-screen';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { useAddWatch } from '@/hooks/use-watchlist';
import { haptic } from '@/lib/haptics';

type Errors = Partial<Record<'ticker' | 'upper' | 'lower', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));
const blank = (s: string) => s.trim() === '';
// Number() also reads "Infinity", which is not a price.
const isPrice = (n: number) => Number.isFinite(n) && n > 0;

export default function AddWatchScreen() {
  const router = useRouter();
  const add = useAddWatch();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/watchlist'));

  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [upper, setUpper] = useState('');
  const [lower, setLower] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker, e.g. NVDA';
    if (!blank(upper) && !isPrice(num(upper))) e.upper = 'Enter a price above 0';
    if (!blank(lower) && !isPrice(num(lower))) e.lower = 'Enter a price above 0';
    if (!e.upper && !e.lower && !blank(upper) && !blank(lower) && num(lower) >= num(upper)) {
      e.lower = 'Must be below the upper limit';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      haptic('warning');
      return;
    }
    add.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        name: name.trim() || null,
        upper_limit: blank(upper) ? null : num(upper),
        lower_limit: blank(lower) ? null : num(lower),
        note: note.trim() || null,
      },
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
    <ScrollScreen avoidKeyboard>
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
        label="Alert above (optional)"
        error={errors.upper}
        value={upper}
        onChangeText={setUpper}
        placeholder="500"
        keyboardType="decimal-pad"
      />
      <TextField
        label="Alert below (optional)"
        error={errors.lower}
        value={lower}
        onChangeText={setLower}
        placeholder="350"
        keyboardType="decimal-pad"
      />
      <ThemedText type="small" themeColor="textSecondary">
        You get an email when the price reaches either limit. Set where to send it under Email
        alerts on the Watchlist.
      </ThemedText>
      <TextField
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Why are you watching it?"
      />
      <ThemedText type="small" themeColor="textSecondary">
        Adding a ticker that is already on the list updates its limits and note.
      </ThemedText>

      {add.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {add.error.message}
        </ThemedText>
      ) : null}

      <Button title="Save" onPress={submit} loading={add.isPending} />
      <Button title="Cancel" variant="secondary" onPress={close} />
    </ScrollScreen>
  );
}
