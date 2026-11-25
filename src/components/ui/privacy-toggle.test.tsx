import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { PrivacyToggle } from '@/components/ui/privacy-toggle';
import { usePreferences } from '@/stores/preferences';

const toggle = () => screen.getByRole('switch', { name: 'Hide balances' });

test('is off by default and exposes its state to screen readers', async () => {
  await render(<PrivacyToggle />);
  expect(toggle()).not.toBeChecked();
});

test('pressing it hides balances, and pressing again shows them', async () => {
  await render(<PrivacyToggle />);
  await fireEvent.press(toggle());
  expect(usePreferences.getState().hideBalances).toBe(true);
  expect(toggle()).toBeChecked();
  await fireEvent.press(toggle());
  expect(usePreferences.getState().hideBalances).toBe(false);
  expect(toggle()).not.toBeChecked();
});

test('reflects a setting that was already saved', async () => {
  usePreferences.setState({ hideBalances: true });
  await render(<PrivacyToggle />);
  expect(toggle()).toBeChecked();
});

test('the choice is saved to the device', async () => {
  await render(<PrivacyToggle />);
  await fireEvent.press(toggle());
  await new Promise((r) => setImmediate(r));
  const saved = JSON.parse((await AsyncStorage.getItem('freeman-preferences'))!);
  expect(saved.state.hideBalances).toBe(true);
});
