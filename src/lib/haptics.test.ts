import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { haptic } from '@/lib/haptics';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  performAndroidHapticsAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: { Confirm: 'confirm', Reject: 'reject', Context_Click: 'context-click' },
}));

const notification = Haptics.notificationAsync as jest.Mock;
const android = Haptics.performAndroidHapticsAsync as jest.Mock;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  notification.mockResolvedValue(undefined);
  android.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test.each([
  ['success', 'success'],
  ['warning', 'warning'],
  ['error', 'error'],
] as const)('iOS maps %s to the %s notification', async (kind, expected) => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  haptic(kind);
  await flush();
  expect(notification).toHaveBeenCalledWith(expected);
  expect(android).not.toHaveBeenCalled();
});

test.each([
  ['success', 'confirm'],
  ['error', 'reject'],
  ['warning', 'context-click'],
] as const)('Android prefers its own haptics: %s -> %s', async (kind, expected) => {
  jest.replaceProperty(Platform, 'OS', 'android');
  haptic(kind);
  await flush();
  expect(android).toHaveBeenCalledWith(expected);
  expect(notification).not.toHaveBeenCalled();
});

test('Android falls back to the vibrator notification when its haptics are unavailable', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  android.mockRejectedValue(new Error('UnavailabilityError'));
  haptic('success');
  await flush();
  expect(notification).toHaveBeenCalledWith('success');
});

test('does nothing on web', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  haptic('success');
  await flush();
  expect(notification).not.toHaveBeenCalled();
  expect(android).not.toHaveBeenCalled();
});

test('never throws or rejects when haptics are missing entirely', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  notification.mockRejectedValue(new Error('The method or property notificationAsync is not available on ios'));
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    expect(() => haptic('error')).not.toThrow();
    await flush();
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
