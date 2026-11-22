import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePreferences } from '@/stores/preferences';

/** An eye button that masks (or shows) every amount in the app. */
export function PrivacyToggle() {
  const theme = useTheme();
  const hidden = usePreferences((s) => s.hideBalances);
  const toggle = usePreferences((s) => s.toggleHideBalances);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Hide balances"
      accessibilityState={{ checked: hidden }}
      hitSlop={8}
      onPress={toggle}
      style={styles.button}>
      <MaterialCommunityIcons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={24} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44 x 44 touch target
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', margin: -Spacing.one },
});
