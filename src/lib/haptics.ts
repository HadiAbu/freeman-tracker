import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'success' | 'warning' | 'error';

/**
 * Best-effort haptic feedback. It never throws and never rejects: feedback is a nicety, and
 * the native haptics module can be missing or out of step with the JS package (for example an
 * Expo Go build older than the installed expo-haptics), which surfaces as an UnavailabilityError.
 *
 * Android prefers `performAndroidHapticsAsync` (what the library recommends; needs no VIBRATE
 * permission) and falls back to the Vibrator-based `notificationAsync`.
 */
export function haptic(kind: HapticKind): void {
  if (Platform.OS === 'web') return;
  void play(kind).catch(() => {
    // Haptics unavailable on this device/build: stay silent.
  });
}

async function play(kind: HapticKind): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Haptics.performAndroidHapticsAsync(
        kind === 'success'
          ? Haptics.AndroidHaptics.Confirm
          : kind === 'error'
            ? Haptics.AndroidHaptics.Reject
            : Haptics.AndroidHaptics.Context_Click,
      );
      return;
    } catch {
      // fall through to the Vibrator-based call
    }
  }
  await Haptics.notificationAsync(
    kind === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : kind === 'error'
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Warning,
  );
}
