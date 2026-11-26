import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { AccountButton } from '@/components/layout/account-button';
import { useAuth } from '@/stores/auth';

const mockEnd = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/lib/session', () => ({ endSession: (...a: unknown[]) => mockEnd(...a) }));
jest.mock('@/lib/confirm', () => ({
  confirmDestructive: (...a: unknown[]) => mockConfirm(...a),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', email: 'a@b.co' });
});

test('asks before signing out, naming the account, and does nothing if the user backs out', async () => {
  await render(<AccountButton />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockConfirm).toHaveBeenCalledWith(
    'Sign out?',
    'Signed in as a@b.co.',
    'Sign out',
    expect.any(Function),
  );
  expect(mockEnd).not.toHaveBeenCalled();
});

test('confirming ends the session', async () => {
  await render(<AccountButton />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  mockConfirm.mock.calls[0][3]();
  expect(mockEnd).toHaveBeenCalledTimes(1);
});
