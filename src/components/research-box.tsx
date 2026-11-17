import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';

const TICKER = /^[A-Za-z0-9.\-]{1,15}$/;

/** Type any ticker and open its news analysis. */
export function ResearchBox({ onSubmit }: { onSubmit: (ticker: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const t = value.trim();
    if (!TICKER.test(t)) {
      setError('Enter a ticker, e.g. NVDA');
      return;
    }
    setError(undefined);
    onSubmit(t.toUpperCase());
  };

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <TextField
          label="Research a ticker"
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(undefined);
          }}
          error={error}
          placeholder="NVDA"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={submit}
        />
      </View>
      <Button title="Research" onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  field: { flex: 1 },
});
