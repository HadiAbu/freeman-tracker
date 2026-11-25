import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { Spacing } from '@/constants/theme';
import { isSafeHttpsUrl, openSafeLink } from '@/lib/safe-link';
import { timeAgo } from '@/lib/time-ago';
import type { AnalysisSource } from '@/types';

export function SourceList({ sources, now }: { sources: AnalysisSource[]; now?: Date }) {
  if (sources.length === 0) return null;
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold">Sources</ThemedText>
      {sources.map((s, i) => {
        const label = `${i + 1}. ${s.title}`;
        const meta = `${s.source} · ${timeAgo(s.published_at, now)}`;
        const linkable = isSafeHttpsUrl(s.url);
        return (
          <View key={s.id} style={styles.row}>
            {linkable ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${s.title}, opens in browser`}
                onPress={() => openSafeLink(s.url)}>
                <ThemedText type="link">{label}</ThemedText>
              </Pressable>
            ) : (
              <ThemedText>{label}</ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {meta}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  row: { gap: Spacing.half },
});
