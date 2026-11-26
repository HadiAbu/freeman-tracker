import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { Spacing } from '@/constants/theme';
import type { CasePoint } from '@/types';

type Props = {
  title: string;
  points: CasePoint[];
  /** source id -> its 1-based number in the Sources list */
  sourceNumbers: Record<string, number>;
};

export function CaseList({ title, points, sourceNumbers }: Props) {
  if (points.length === 0) return null;
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {points.map((p, i) => {
        const cites = p.source_ids
          .map((id) => sourceNumbers[id])
          .filter((n): n is number => typeof n === 'number')
          .map((n) => `[${n}]`)
          .join(' ');
        return (
          <View key={i} style={styles.point}>
            <ThemedText>{p.point}</ThemedText>
            {cites ? (
              <ThemedText type="small" themeColor="textSecondary">
                {cites}
              </ThemedText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  point: { gap: Spacing.half },
});
