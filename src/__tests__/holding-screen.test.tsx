import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import HoldingScreen from '@/app/holding/[ticker]';
import { api } from '@/lib/api';
import { holding, summary, trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ ticker: 'aapl' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
// The charts need SVG; their own props are what matter here.
const mockTrendLine = jest.fn();
jest.mock('@/components/charts/trend-line', () => ({
  TrendLine: (props: unknown) => {
    mockTrendLine(props);
    return null;
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: {
      portfolioSummary: jest.fn(),
      listTrades: jest.fn(),
      priceHistory: jest.fn(),
      putHolding: jest.fn(),
    },
  };
});

const portfolioSummary = api.portfolioSummary as jest.Mock;
const listTrades = api.listTrades as jest.Mock;
const priceHistory = api.priceHistory as jest.Mock;
const putHolding = api.putHolding as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  portfolioSummary.mockResolvedValue(summary());
  listTrades.mockResolvedValue([
    trade({ id: 7, ticker: 'AAPL', traded_at: '2026-10-01', price: 150 }),
  ]);
  priceHistory.mockResolvedValue([
    { id: 1, ticker: 'AAPL', price: 180, as_of: '2026-11-01', source: 'manual' },
  ]);
  putHolding.mockResolvedValue({});
});

test('shows the position stats and asks the server for only this ticker', async () => {
  await renderWithClient(<HoldingScreen />);
  expect(await screen.findByText('$1,800.00')).toBeTruthy();
  expect(screen.getByText('Apple Inc.')).toBeTruthy();
  expect(screen.getByText(/\+\$300\.00 \(\+20\.00%\)/)).toBeTruthy();
  expect(screen.getByText('Avg cost')).toBeTruthy();
  expect(listTrades).toHaveBeenCalledWith({ ticker: 'AAPL', limit: 1000 });
  expect(priceHistory).toHaveBeenCalledWith('AAPL');
});

test('the price line merges trade prices and price marks in date order', async () => {
  await renderWithClient(<HoldingScreen />);
  await screen.findByText('$1,800.00');
  await waitFor(() => {
    const last = mockTrendLine.mock.calls.at(-1)?.[0] as {
      points: { date: string; value: number }[];
    };
    expect(last.points).toEqual([
      { date: '2026-10-01', value: 150 },
      { date: '2026-11-01', value: 180 },
    ]);
  });
});

test('Log price and Research open their screens for this ticker', async () => {
  await renderWithClient(<HoldingScreen />);
  await screen.findByText('$1,800.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Log price' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/log-price', params: { ticker: 'AAPL' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Research with news' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/analysis/[ticker]',
    params: { ticker: 'AAPL' },
  });
});

test('saving the classification sends trimmed values and null for blanks', async () => {
  portfolioSummary.mockResolvedValue(
    summary({ holdings: [holding({ name: null, sector: null, asset_class: null })] }),
  );
  await renderWithClient(<HoldingScreen />);
  await fireEvent.changeText(await screen.findByLabelText('Sector'), '  Technology ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save classification' }));
  await waitFor(() =>
    expect(putHolding).toHaveBeenCalledWith('AAPL', {
      name: null,
      sector: 'Technology',
      asset_class: null,
    }),
  );
  expect(await screen.findByText('Saved')).toBeTruthy();
});

test('a failed classification save shows the error', async () => {
  putHolding.mockRejectedValue(new Error('Could not save'));
  await renderWithClient(<HoldingScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Save classification' }));
  expect(await screen.findByText('Could not save')).toBeTruthy();
  expect(screen.queryByText('Saved')).toBeNull();
});

test('a fully sold position says it is closed and offers no classification', async () => {
  portfolioSummary.mockResolvedValue(summary({ holdings: [] }));
  await renderWithClient(<HoldingScreen />);
  expect(await screen.findByText('This position is closed.')).toBeTruthy();
  expect(screen.queryByText('Classification')).toBeNull();
});

test('an unknown ticker says no trades were found', async () => {
  portfolioSummary.mockResolvedValue(summary({ holdings: [] }));
  listTrades.mockResolvedValue([]);
  await renderWithClient(<HoldingScreen />);
  expect(await screen.findByText('No trades found for AAPL.')).toBeTruthy();
});

test('a failed load shows the error and Try again refetches both queries', async () => {
  portfolioSummary.mockRejectedValueOnce(new Error('Server error'));
  await renderWithClient(<HoldingScreen />);
  expect(await screen.findByText('Server error')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('$1,800.00')).toBeTruthy();
});
