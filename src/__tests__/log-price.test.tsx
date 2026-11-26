import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import LogPriceScreen from '@/app/log-price';
import { api } from '@/lib/api';
import { todayISO } from '@/lib/format';
import { renderWithClient } from '@/test-utils/render';

const mockBack = jest.fn();
let mockParams: { ticker?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { addPrice: jest.fn() } };
});

const addPrice = api.addPrice as jest.Mock;
const save = () => screen.getByRole('button', { name: 'Save price' });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { ticker: 'aapl' };
  addPrice.mockResolvedValue({ id: 1 });
});

test('a ticker from the route is upper-cased and locked; the date defaults to today', async () => {
  await renderWithClient(<LogPriceScreen />);
  const ticker = screen.getByLabelText('Ticker');
  expect(ticker.props.value).toBe('AAPL');
  expect(ticker.props.editable).toBe(false);
  expect(screen.getByLabelText('As of').props.value).toBe(todayISO());
});

test('without a route ticker the field is editable', async () => {
  mockParams = {};
  await renderWithClient(<LogPriceScreen />);
  expect(screen.getByLabelText('Ticker').props.editable).toBe(true);
});

test('saves the price (comma decimal accepted) and closes', async () => {
  await renderWithClient(<LogPriceScreen />);
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '189,5');
  await fireEvent.changeText(screen.getByLabelText('As of'), '2026-11-20');
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(addPrice).toHaveBeenCalledWith({ ticker: 'AAPL', price: 189.5, as_of: '2026-11-20' });
});

test.each(['', '0', '-3', 'abc'])('rejects price %p', async (bad) => {
  await renderWithClient(<LogPriceScreen />);
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), bad);
  await fireEvent.press(save());
  expect(screen.getByText('Price must be greater than 0')).toBeTruthy();
  expect(addPrice).not.toHaveBeenCalled();
});

test.each(['2026-13-01', '20-11-2026', '2026-1-1', 'today'])('rejects date %p', async (bad) => {
  await renderWithClient(<LogPriceScreen />);
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '10');
  await fireEvent.changeText(screen.getByLabelText('As of'), bad);
  await fireEvent.press(save());
  expect(screen.getByText('Use the format YYYY-MM-DD')).toBeTruthy();
  expect(addPrice).not.toHaveBeenCalled();
});

test('a server error is shown and the form stays open', async () => {
  addPrice.mockRejectedValue(new Error('Price out of range'));
  await renderWithClient(<LogPriceScreen />);
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '10');
  await fireEvent.press(save());
  expect(await screen.findByText('Price out of range')).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

test.each([
  ['Infinity', 'Price must be greater than 0'],
  ['1e308', 'That number is too large'],
])('rejects the price %p', async (bad, message) => {
  await renderWithClient(<LogPriceScreen />);
  await fireEvent.changeText(screen.getByLabelText('Price (USD)'), bad);
  await fireEvent.press(save());
  expect(screen.getByText(message)).toBeTruthy();
  expect(addPrice).not.toHaveBeenCalled();
});
