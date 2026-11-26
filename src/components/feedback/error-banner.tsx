import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  message: string;
  /** Called by the action button: dismiss by default, or retry when `actionLabel` says so. */
  onDismiss: () => void;
  actionLabel?: string;
};

/**
 * Inline error that works the same on iOS, Android and web. (Alert.alert is a silent no-op on
 * react-native-web, so mutation errors must not rely on it.)
 */
export function ErrorBanner({ message, onDismiss, actionLabel = 'Dismiss' }: Props) {
  return (
    <ThemedView type="backgroundElement" style={styles.banner} accessibilityRole="alert">
      <View style={styles.text}>
        <ThemedText type="smallBold" themeColor="loss">
          Something went wrong
        </ThemedText>
        <ThemedText type="small">{message}</ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onDismiss}
        hitSlop={8}
      >
        <ThemedText type="smallBold">{actionLabel}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  text: { flex: 1, gap: Spacing.half },
});
