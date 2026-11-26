import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import SignInScreen from '@/app/sign-in';
import { renderWithClient } from '@/test-utils/render';

const mockSignIn = jest.fn();
const mockRegister = jest.fn();
jest.mock('@/lib/session', () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    AuthError,
    signIn: (...a: unknown[]) => mockSignIn(...a),
    register: (...a: unknown[]) => mockRegister(...a),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue(undefined);
  mockRegister.mockResolvedValue(undefined);
});

const fill = async (email: string, password: string) => {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
};
const submit = (name: string) => screen.getByRole('button', { name });

test('the button stays disabled until the email looks valid and a password is typed', async () => {
  await renderWithClient(<SignInScreen />);
  expect(submit('Sign in')).toBeDisabled();
  await fill('not-an-email', 'secret');
  expect(submit('Sign in')).toBeDisabled();
  await fill('a@b.co', 'secret');
  expect(submit('Sign in')).toBeEnabled();
});

test('signing in sends the typed credentials', async () => {
  await renderWithClient(<SignInScreen />);
  await fill('a@b.co', 'secret');
  await fireEvent.press(submit('Sign in'));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('a@b.co', 'secret'));
});

test('a wrong password shows the server message and lets the user retry', async () => {
  const { AuthError } = jest.requireMock('@/lib/session');
  mockSignIn.mockRejectedValueOnce(new AuthError(401, 'Incorrect email or password'));
  await renderWithClient(<SignInScreen />);
  await fill('a@b.co', 'wrong');
  await fireEvent.press(submit('Sign in'));
  expect(await screen.findByText('Incorrect email or password')).toBeTruthy();
  expect(submit('Sign in')).toBeEnabled();
});

test('creating an account needs a password of at least 10 characters', async () => {
  await renderWithClient(<SignInScreen />);
  await fireEvent.press(submit('Create an account'));
  await fill('a@b.co', 'too short');
  expect(submit('Create account')).toBeDisabled();
  await fill('a@b.co', 'long enough password');
  await fireEvent.press(submit('Create account'));
  await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('a@b.co', 'long enough password'));
  expect(mockSignIn).not.toHaveBeenCalled();
});

test('an unexpected failure shows a generic message, never a raw error', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('TypeError: x is undefined at line 42'));
  await renderWithClient(<SignInScreen />);
  await fill('a@b.co', 'secret');
  await fireEvent.press(submit('Sign in'));
  expect(await screen.findByText(/Something went wrong\. Please try again\./)).toBeTruthy();
  expect(screen.queryByText(/line 42/)).toBeNull();
});
