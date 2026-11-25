import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import WatchlistScreen from '@/app/(tabs)/watchlist';
import { api } from '@/lib/api';
import { watchItem } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
// Run the confirmed action straight away; the real helper shows a native alert.
const mockConfirm = jest.fn((_t: string, _m: string, _l: string, onConfirm: () => void) =>
  onConfirm(),
);
jest.mock('@/lib/confirm', () => ({
  confirmDestructive: (...args: [string, string, string, () => void]) => mockConfirm(...args),
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { listWatchlist: jest.fn(), deleteWatch: jest.fn() } };
});

const listWatchlist = api.listWatchlist as jest.Mock;
const deleteWatch = api.deleteWatch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  listWatchlist.mockResolvedValue([watchItem()]);
  deleteWatch.mockResolvedValue(undefined);
});

test('lists watched tickers with their alert status and last price', async () => {
  listWatchlist.mockResolvedValue([
    watchItem({ id: 1, ticker: 'AAPL', price: 180, upper_limit: 200, pct_to_target: 11.11 }),
    watchItem({
      id: 2,
      ticker: 'MSFT',
      name: 'Microsoft',
      price: 410,
      upper_limit: 400,
      upper_state: 'triggered',
      pct_to_target: -2.4,
    }),
    watchItem({
      id: 3,
      ticker: 'TSLA',
      name: null,
      price: null,
      price_kind: null,
      price_as_of: null,
      upper_limit: null,
      pct_to_target: null,
    }),
  ]);
  await renderWithClient(<WatchlistScreen />);
  expect(await screen.findByText('Alert above $200.00 · +11.11% to go')).toBeTruthy();
  expect(screen.getByText(/Alert above \$400\.00 · paused/)).toBeTruthy();
  expect(screen.getByText('No alerts set')).toBeTruthy();
  expect(screen.getByText('No price yet')).toBeTruthy();
});

test('shows a designed empty state when nothing is watched', async () => {
  listWatchlist.mockResolvedValue([]);
  await renderWithClient(<WatchlistScreen />);
  expect(await screen.findByText('Nothing on your watchlist')).toBeTruthy();
  expect(screen.queryByText(/Long press to remove it/)).toBeNull();
});

test('a failed load shows the error and Try again refetches', async () => {
  listWatchlist.mockRejectedValueOnce(new Error('Could not reach the server'));
  await renderWithClient(<WatchlistScreen />);
  expect(await screen.findByText('Could not reach the server')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('AAPL')).toBeTruthy();
  expect(listWatchlist).toHaveBeenCalledTimes(2);
});

test('navigates to add, log-price and research', async () => {
  await renderWithClient(<WatchlistScreen />);
  await screen.findByText('AAPL');

  await fireEvent.press(screen.getByRole('button', { name: 'Add ticker' }));
  expect(mockPush).toHaveBeenLastCalledWith('/add-watch');

  await fireEvent.press(
    screen.getByRole('button', { name: 'AAPL, tap to log a price, long press to remove' }),
  );
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/log-price', params: { ticker: 'AAPL' } });

  await fireEvent.press(screen.getByRole('button', { name: 'Research AAPL with news' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/analysis/[ticker]',
    params: { ticker: 'AAPL' },
  });
});

test('the ticker box opens the analysis screen for an upper-cased ticker', async () => {
  await renderWithClient(<WatchlistScreen />);
  await screen.findByText('AAPL');
  await fireEvent.changeText(screen.getByLabelText('Research a ticker'), 'nvda');
  await fireEvent.press(screen.getByRole('button', { name: 'Research' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/analysis/[ticker]',
    params: { ticker: 'NVDA' },
  });
});

test('long press confirms, then removes the item', async () => {
  await renderWithClient(<WatchlistScreen />);
  const row = await screen.findByRole('button', {
    name: 'AAPL, tap to log a price, long press to remove',
  });
  await fireEvent(row, 'longPress');
  expect(mockConfirm).toHaveBeenCalledWith(
    'Remove from watchlist?',
    'AAPL',
    'Remove',
    expect.any(Function),
  );
  await waitFor(() => expect(deleteWatch).toHaveBeenCalledWith(1));
});

test('a failed removal shows the error and it can be dismissed', async () => {
  deleteWatch.mockRejectedValue(new Error('Item not found'));
  await renderWithClient(<WatchlistScreen />);
  const row = await screen.findByRole('button', {
    name: 'AAPL, tap to log a price, long press to remove',
  });
  await fireEvent(row, 'longPress');
  expect(await screen.findByText('Item not found')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Item not found')).toBeNull();
});
