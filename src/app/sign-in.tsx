import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/feedback/error-banner';
import { Screen } from '@/components/layout/screen';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import { Spacing } from '@/constants/theme';
import { AuthError, register, signIn } from '@/lib/session';

const MIN_PASSWORD = 10; // matches the server

export default function SignInScreen() {
  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creating = mode === 'register';
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && password.length >= (creating ? MIN_PASSWORD : 1);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await (creating ? register : signIn)(email, password);
      // No navigation here: the root layout swaps to the app as soon as the session exists.
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">{creating ? 'Create account' : 'Sign in'}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {creating
              ? `Use a password of at least ${MIN_PASSWORD} characters.`
              : 'Sign in to see your portfolio.'}
          </ThemedText>

          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={creating ? 'new-password' : 'current-password'}
            textContentType={creating ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <Button
            title={creating ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={busy}
            disabled={!valid}
          />
          <Button
            title={creating ? 'I already have an account' : 'Create an account'}
            variant="secondary"
            onPress={() => {
              setMode(creating ? 'signIn' : 'register');
              setError(null);
            }}
            disabled={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
});
