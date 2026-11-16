import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TopTabInset } from '@/constants/theme';

/** Themed full-screen container with a centered, width-capped content column. */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={[styles.safe, { paddingTop: TopTabInset }]} edges={['top', 'left', 'right']}>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three },
});
