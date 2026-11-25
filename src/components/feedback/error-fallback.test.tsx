import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ErrorFallback } from '@/components/feedback/error-fallback';

const mockReport = jest.fn();
jest.mock('@/lib/error-reporting', () => ({ reportError: (e: unknown) => mockReport(e) }));

test('shows a generic message, never the raw error, and reports it', async () => {
  const error = new Error('secret internal detail');
  await render(<ErrorFallback error={error} retry={jest.fn()} />);
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(screen.queryByText(/secret internal detail/)).toBeNull();
  expect(mockReport).toHaveBeenCalledWith(error);
});

test('Try again calls retry', async () => {
  const retry = jest.fn();
  await render(<ErrorFallback error={new Error('x')} retry={retry} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
