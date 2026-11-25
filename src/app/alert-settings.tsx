import React, { useState } from 'react';

import { ErrorState, LoadingState } from '@/components/feedback/screen-state';
import { ScrollScreen } from '@/components/layout/scroll-screen';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/ui/themed-text';
import {
  useAlertSettings,
  useSaveAlertSettings,
  useSendTestEmail,
} from '@/hooks/use-alert-settings';
import { haptic } from '@/lib/haptics';

// Same shape the server checks: one @, no spaces, a dot in the domain. The test email is the real check.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function AlertSettingsScreen() {
  const settings = useAlertSettings();
  const save = useSaveAlertSettings();
  const test = useSendTestEmail();
  // null means "untouched": show what the server has. Once the user types, show their text.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  if (settings.isPending) return <LoadingState />;
  // A failed background refetch keeps the cached data: only fall back to the error screen when there is nothing to show.
  if (settings.isError && settings.data === undefined)
    return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;

  const saved = settings.data.email ?? '';
  const shown = draft ?? saved;
  const dirty = shown.trim() !== saved;
  const canSend = settings.data.email_configured && saved !== '' && !dirty;

  function onSave() {
    const value = shown.trim();
    if (value !== '' && !EMAIL.test(value)) {
      setError('Enter a valid email address');
      haptic('warning');
      return;
    }
    setError(undefined);
    test.reset();
    save.mutate(value === '' ? null : value, {
      onSuccess: () => {
        setDraft(null);
        haptic('success');
      },
      onError: () => haptic('error'),
    });
  }

  return (
    <ScrollScreen avoidKeyboard>
      <ThemedText type="small" themeColor="textSecondary">
        Price alerts from your watchlist are sent to this address. Leave it empty to turn alerts
        off.
      </ThemedText>
      <TextField
        label="Send alerts to"
        error={error}
        value={shown}
        onChangeText={setDraft}
        placeholder="you@gmail.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ThemedText
        type="small"
        themeColor={settings.data.email_configured ? 'textSecondary' : 'loss'}
      >
        {settings.data.email_configured
          ? 'The server can send email.'
          : 'The server is not set up to send email yet. Set SMTP_USER and SMTP_PASSWORD in api/.env, then restart it.'}
      </ThemedText>

      {save.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {save.error.message}
        </ThemedText>
      ) : null}

      <Button title="Save" onPress={onSave} loading={save.isPending} />
      <Button
        title="Send test email"
        variant="secondary"
        onPress={() => test.mutate(undefined, { onSuccess: () => haptic('success') })}
        loading={test.isPending}
        disabled={!canSend}
      />
      {dirty ? (
        <ThemedText type="small" themeColor="textSecondary">
          Save your change before sending a test.
        </ThemedText>
      ) : null}
      {test.isSuccess ? (
        <ThemedText accessibilityRole="alert">
          Sent to {test.data.sent_to}. Check your inbox, and your spam folder if it is not there.
        </ThemedText>
      ) : null}
      {test.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {test.error.message}
        </ThemedText>
      ) : null}
    </ScrollScreen>
  );
}
