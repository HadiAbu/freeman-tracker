import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/ui/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  /** Lifts the content above the keyboard on iOS. Use it on screens that have text fields. */
  avoidKeyboard?: boolean;
};

/**
 * Themed, scrollable page for the detail and form screens that sit above the tabs (add trade,
 * holding, analysis...). The tab screens use `Screen` instead, which adds the safe area and tab
 * insets.
 *
 * `keyboardShouldPersistTaps="handled"` lets a button be tapped while a field is focused without
 * the first tap only dismissing the keyboard.
 */
export function ScrollScreen({ children, avoidKeyboard = false }: Props) {
  const scroll = (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );

  return (
    <ThemedView style={styles.root}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.root}
        >
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        scroll
      )}
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
  },
});
