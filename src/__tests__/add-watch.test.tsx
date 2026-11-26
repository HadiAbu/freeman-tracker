import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AddWatchScreen from '@/app/add-watch';
import { api } from '@/lib/api';
import { renderWithClient } from '@/test-utils/render';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { addWatch: jest.fn() } };
});

const addWatch = api.addWatch as jest.Mock;
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  jest.clearAllMocks();
  addWatch.mockResolvedValue({ id: 1 });
});

test('saves a normalized item and closes', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), ' nvda ');
  await fireEvent.changeText(screen.getByLabelText('Name (optional)'), ' NVIDIA ');
  await fireEvent.changeText(screen.getByLabelText('Target price (optional)'), '500,5');
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(addWatch).toHaveBeenCalledWith({
    ticker: 'NVDA',
    name: 'NVIDIA',
    target_price: 500.5,
    note: null,
  });
});

test('blank optional fields are sent as null, not empty strings or zero', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'aapl');
  await fireEvent.press(save());
  await waitFor(() => expect(addWatch).toHaveBeenCalled());
  expect(addWatch).toHaveBeenCalledWith({
    ticker: 'AAPL',
    name: null,
    target_price: null,
    note: null,
  });
});

test.each(['', 'A B', 'x'.repeat(16), 'AAPL;DROP'])(
  'rejects ticker %p without a request',
  async (bad) => {
    await renderWithClient(<AddWatchScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ticker'), bad);
    await fireEvent.press(save());
    expect(screen.getByText('Enter a ticker, e.g. NVDA')).toBeTruthy();
    expect(addWatch).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  },
);

test('rejects a negative or non-numeric target', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
  await fireEvent.changeText(screen.getByLabelText('Target price (optional)'), '-5');
  await fireEvent.press(save());
  expect(screen.getByText('Target must be 0 or more')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Target price (optional)'), 'abc');
  await fireEvent.press(save());
  expect(screen.getByText('Target must be 0 or more')).toBeTruthy();
  expect(addWatch).not.toHaveBeenCalled();
});

test('a server error is shown and the form stays open with its input', async () => {
  addWatch.mockRejectedValue(new Error('Ticker not recognised'));
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'zzzz');
  await fireEvent.press(save());
  expect(await screen.findByText('Ticker not recognised')).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Ticker').props.value).toBe('zzzz');
});

test('Cancel closes without saving', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockBack).toHaveBeenCalled();
  expect(addWatch).not.toHaveBeenCalled();
});
