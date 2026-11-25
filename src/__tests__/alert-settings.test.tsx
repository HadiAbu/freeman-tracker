import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AlertSettingsScreen from '@/app/alert-settings';
import { api } from '@/lib/api';
import { renderWithClient } from '@/test-utils/render';

jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: { getAlertSettings: jest.fn(), saveAlertSettings: jest.fn(), sendTestAlert: jest.fn() },
  };
});

const getSettings = api.getAlertSettings as jest.Mock;
const saveSettings = api.saveAlertSettings as jest.Mock;
const sendTest = api.sendTestAlert as jest.Mock;
const field = () => screen.getByLabelText('Send alerts to');

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ email: 'me@mail.com', email_configured: true });
  saveSettings.mockImplementation(async (email: string | null) => ({
    email,
    email_configured: true,
  }));
  sendTest.mockResolvedValue({ sent_to: 'me@mail.com' });
});

test('shows the saved address and that the server can send email', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  expect(screen.getByText('The server can send email.')).toBeTruthy();
});

test('says plainly when the server has no email settings, and disables the test button', async () => {
  getSettings.mockResolvedValue({ email: 'me@mail.com', email_configured: false });
  await renderWithClient(<AlertSettingsScreen />);
  expect(await screen.findByText(/not set up to send email/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Send test email' }).props.accessibilityState.disabled,
  ).toBe(true);
});

test('saves a trimmed address', async () => {
  getSettings.mockResolvedValue({ email: null, email_configured: true });
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(getSettings).toHaveBeenCalled());
  await fireEvent.changeText(field(), '  new@mail.com ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('new@mail.com'));
});

test('an empty address turns alerts off', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), '');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(null));
});

test('rejects an address that is not an email without a request', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), 'not-an-email');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Enter a valid email address')).toBeTruthy();
  expect(saveSettings).not.toHaveBeenCalled();
});

test('the test email goes to the saved address and the result is shown', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.press(screen.getByRole('button', { name: 'Send test email' }));
  expect(await screen.findByText(/Sent to me@mail\.com/)).toBeTruthy();
  expect(sendTest).toHaveBeenCalledTimes(1);
});

test('a failed test email shows the reason', async () => {
  sendTest.mockRejectedValue(new Error('email could not be sent (SMTPAuthenticationError)'));
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.press(screen.getByRole('button', { name: 'Send test email' }));
  expect(await screen.findByText(/SMTPAuthenticationError/)).toBeTruthy();
});

test('the test button waits for unsaved changes to be saved first', async () => {
  await renderWithClient(<AlertSettingsScreen />);
  await waitFor(() => expect(field().props.value).toBe('me@mail.com'));
  await fireEvent.changeText(field(), 'other@mail.com');
  expect(
    screen.getByRole('button', { name: 'Send test email' }).props.accessibilityState.disabled,
  ).toBe(true);
  expect(screen.getByText('Save your change before sending a test.')).toBeTruthy();
});
