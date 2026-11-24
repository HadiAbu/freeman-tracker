import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { reportError } from '@/lib/monitoring';

type Props = { error: Error; retry: () => Promise<void> | void };

/**
 * Fallback for an uncaught render error. Expo Router renders this in place of the broken route
 * when it is exported as `ErrorBoundary` from a layout. The message is deliberately generic:
 * the real error goes to monitoring, not to the screen.
 */
export function AppErrorScreen({ error, retry }: Props) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <ThemedView style={styles.container} accessibilityRole="alert">
      <ThemedText type="subtitle">Something went wrong</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.body}>
        The app hit an unexpected problem. Your data is safe. Try again, and if it keeps happening, restart the app.
      </ThemedText>
      <Button title="Try again" onPress={() => void retry()} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  body: { marginBottom: Spacing.two },
});
