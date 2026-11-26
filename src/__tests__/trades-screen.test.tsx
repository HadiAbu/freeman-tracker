import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import TradesScreen from '@/app/(tabs)/trades';
import { api } from '@/lib/api';
import { trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
const mockConfirm = jest.fn((_t: string, _m: string, _l: string, onConfirm: () => void) =>
  onConfirm(),
);
jest.mock('@/lib/confirm', () => ({
  confirmDestructive: (...args: [string, string, string, () => void]) => mockConfirm(...args),
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { listTrades: jest.fn(), deleteTrade: jest.fn() } };
});

const listTrades = api.listTrades as jest.Mock;
const deleteTrade = api.deleteTrade as jest.Mock;

const page = (n: number, startId = 1) =>
  Array.from({ length: n }, (_, i) => trade({ id: startId + i, ticker: `T${startId + i}` }));

beforeEach(() => {
  jest.clearAllMocks();
  listTrades.mockResolvedValue([
    trade({ id: 1, ticker: 'NVDA', side: 'buy', shares: 2, price: 100 }),
  ]);
  deleteTrade.mockResolvedValue(undefined);
});

test('lists trades with side, quantity, price and total', async () => {
  listTrades.mockResolvedValue([
    trade({ id: 1, ticker: 'NVDA', side: 'buy', shares: 2, price: 100, fee: 1 }),
    trade({ id: 2, ticker: 'AAPL', side: 'sell', shares: 3, price: 50, fee: 1 }),
  ]);
  await renderWithClient(<TradesScreen />);
  expect(await screen.findByText('NVDA')).toBeTruthy();
  expect(screen.getByText('BUY')).toBeTruthy();
  expect(screen.getByText('SELL')).toBeTruthy();
  // a buy costs its fee on top, a sell nets it off
  expect(screen.getByText('$201.00')).toBeTruthy();
  expect(screen.getByText('$149.00')).toBeTruthy();
});

test('shows a designed empty state with the next action', async () => {
  listTrades.mockResolvedValue([]);
  await renderWithClient(<TradesScreen />);
  expect(await screen.findByText('No trades yet')).toBeTruthy();
  expect(screen.getByText(/to log your first buy or sell/)).toBeTruthy();
});

test('a failed load shows the error and Try again refetches', async () => {
  listTrades.mockRejectedValueOnce(new Error('Server error'));
  await renderWithClient(<TradesScreen />);
  expect(await screen.findByText('Server error')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('NVDA')).toBeTruthy();
});

test('the side filter asks the server for only that side', async () => {
  await renderWithClient(<TradesScreen />);
  await screen.findByText('NVDA');
  await fireEvent.press(screen.getByRole('button', { name: 'Buys' }));
  await waitFor(() =>
    expect(listTrades).toHaveBeenCalledWith({ side: 'buy', limit: 100, offset: 0 }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Sells' }));
  await waitFor(() =>
    expect(listTrades).toHaveBeenCalledWith({ side: 'sell', limit: 100, offset: 0 }),
  );
  expect(screen.getByRole('button', { name: 'Sells' })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Buys' })).not.toBeSelected();
});

test('a full page offers older trades and loads the next page by offset', async () => {
  listTrades.mockResolvedValueOnce(page(100)).mockResolvedValueOnce(page(5, 101));
  await renderWithClient(<TradesScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Load older trades' }));
  await waitFor(() =>
    expect(listTrades).toHaveBeenCalledWith({ side: undefined, limit: 100, offset: 100 }),
  );
  // a short second page is the last one
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Load older trades' })).toBeNull(),
  );
});

test('a short first page has no Load older trades button', async () => {
  await renderWithClient(<TradesScreen />);
  await screen.findByText('NVDA');
  expect(screen.queryByRole('button', { name: 'Load older trades' })).toBeNull();
});

test('Add trade opens the add-trade modal', async () => {
  await renderWithClient(<TradesScreen />);
  await screen.findByText('NVDA');
  await fireEvent.press(screen.getByRole('button', { name: 'Add trade' }));
  expect(mockPush).toHaveBeenCalledWith('/add-trade');
});

test('long press confirms with the trade details, then deletes it', async () => {
  await renderWithClient(<TradesScreen />);
  await fireEvent(await screen.findByText('NVDA'), 'longPress');
  expect(mockConfirm).toHaveBeenCalledWith(
    'Delete trade?',
    'BUY 2 NVDA on 2026-11-01',
    'Delete',
    expect.any(Function),
  );
  await waitFor(() => expect(deleteTrade).toHaveBeenCalledWith(1));
});

test('a rejected delete (a later sell depends on it) shows the server message', async () => {
  deleteTrade.mockRejectedValue(new Error('Cannot delete: a later sell depends on this buy'));
  await renderWithClient(<TradesScreen />);
  await fireEvent(await screen.findByText('NVDA'), 'longPress');
  expect(await screen.findByText('Cannot delete: a later sell depends on this buy')).toBeTruthy();
});
