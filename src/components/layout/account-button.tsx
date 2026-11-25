import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { endSession } from '@/lib/session';
import { useAuth } from '@/stores/auth';

/** Signs the user out after a confirmation. Sits next to the privacy toggle in screen headers. */
export function AccountButton() {
  const theme = useTheme();
  const email = useAuth((s) => s.email);

  const onPress = () =>
    confirmDestructive(
      'Sign out?',
      email ? `Signed in as ${email}.` : 'You will need to sign in again.',
      'Sign out',
      () => {
        void endSession();
      },
    );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      hitSlop={8}
      onPress={onPress}
      style={styles.button}
    >
      <MaterialCommunityIcons name="logout" size={24} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44 x 44 touch target
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    margin: -Spacing.one,
  },
});
