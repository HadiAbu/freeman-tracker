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
  await fireEvent.changeText(screen.getByLabelText('Alert above (optional)'), '500,5');
  await fireEvent.changeText(screen.getByLabelText('Alert below (optional)'), '350');
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(addWatch).toHaveBeenCalledWith({
    ticker: 'NVDA',
    name: 'NVIDIA',
    upper_limit: 500.5,
    lower_limit: 350,
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
    upper_limit: null,
    lower_limit: null,
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

test.each([
  ['Alert above (optional)', '-5'],
  ['Alert above (optional)', 'abc'],
  ['Alert above (optional)', '0'],
  ['Alert above (optional)', 'Infinity'],
  ['Alert below (optional)', '0'],
  ['Alert below (optional)', 'Infinity'],
  ['Alert below (optional)', '-5'],
  ['Alert below (optional)', 'abc'],
])('rejects %p = %p without a request', async (label, value) => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
  await fireEvent.changeText(screen.getByLabelText(label), value);
  await fireEvent.press(save());
  expect(screen.getByText('Enter a price above 0')).toBeTruthy();
  expect(addWatch).not.toHaveBeenCalled();
});

test('the lower limit must be below the upper limit', async () => {
  await renderWithClient(<AddWatchScreen />);
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
  await fireEvent.changeText(screen.getByLabelText('Alert above (optional)'), '100');
  await fireEvent.changeText(screen.getByLabelText('Alert below (optional)'), '100');
  await fireEvent.press(save());
  expect(screen.getByText('Must be below the upper limit')).toBeTruthy();
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

test.each(['Alert above (optional)', 'Alert below (optional)'])(
  'rejects an absurdly large %p',
  async (label) => {
    await renderWithClient(<AddWatchScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ticker'), 'AAPL');
    await fireEvent.changeText(screen.getByLabelText(label), '1e308');
    await fireEvent.press(save());
    expect(screen.getByText('That number is too large')).toBeTruthy();
    expect(addWatch).not.toHaveBeenCalled();
  },
);
