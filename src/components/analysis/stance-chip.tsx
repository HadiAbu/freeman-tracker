import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confidenceLabel, stanceSpoken, stanceTitle } from '@/lib/stance';
import type { Confidence, Stance } from '@/types';

const ICONS: Record<Stance, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  buy: 'arrow-up-bold-circle-outline',
  hold: 'pause-circle-outline',
  sell: 'arrow-down-bold-circle-outline',
  unclear: 'help-circle-outline',
};

/** The lean as an icon plus text. Color is never the carrier of meaning. */
export function StanceChip({ stance, confidence }: { stance: Stance; confidence: Confidence }) {
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={styles.chip}
      accessible
      accessibilityLabel={stanceSpoken(stance, confidence)}>
      <MaterialCommunityIcons name={ICONS[stance]} size={28} color={theme.text} />
      <View>
        <ThemedText type="smallBold">{stanceTitle(stance)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {confidenceLabel(confidence)}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignSelf: 'flex-start',
  },
});
