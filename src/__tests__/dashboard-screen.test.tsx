import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import DashboardScreen from '@/app/(tabs)/index';
import { api } from '@/lib/api';
import { summary, trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
// Charts need SVG. Render what they were given as text so the screen's wiring is checkable.
jest.mock('@/components/charts/trend-line', () => ({
  TrendLine: ({ points }: { points: unknown[] }) => {
    const { Text } = require('react-native');
    return <Text>{`trend:${points.length}`}</Text>;
  },
}));
jest.mock('@/components/charts/allocation-donut', () => ({
  AllocationDonut: ({ slices }: { slices: { label: string }[] }) => {
    const { Text } = require('react-native');
    return <Text>{`donut:${slices.map((s) => s.label).join(',')}`}</Text>;
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: {
      portfolioSummary: jest.fn(),
      listTrades: jest.fn(),
      history: jest.fn(),
      allocation: jest.fn(),
    },
  };
});

const portfolioSummary = api.portfolioSummary as jest.Mock;
const listTrades = api.listTrades as jest.Mock;
const history = api.history as jest.Mock;
const allocation = api.allocation as jest.Mock;

const slice = (label: string, percent: number, slot: number) => ({
  label,
  value: percent * 100,
  percent,
  slot,
});

beforeEach(() => {
  jest.clearAllMocks();
  portfolioSummary.mockResolvedValue(summary());
  listTrades.mockResolvedValue([trade({ id: 1, ticker: 'NVDA' })]);
  history.mockResolvedValue([
    { date: '2026-10-01', value: 100, cost: 90 },
    { date: '2026-11-01', value: 120, cost: 90 },
  ]);
  allocation.mockResolvedValue([slice('AAPL', 60, 0), slice('NVDA', 40, 1)]);
});

test('shows portfolio value, unrealized and realized figures', async () => {
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('$12,345.67')).toBeTruthy();
  expect(screen.getByText('+$1,234.56 (+11.11%) unrealized')).toBeTruthy();
  expect(screen.getByText('Cost $11,111.11 · Realized -$50.00')).toBeTruthy();
});

test('feeds the history and allocation charts and lists recent trades', async () => {
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('trend:2')).toBeTruthy();
  expect(await screen.findByText('donut:AAPL,NVDA')).toBeTruthy();
  expect(await screen.findByText('NVDA')).toBeTruthy();
  expect(listTrades).toHaveBeenCalledWith({ limit: 5 });
  expect(allocation).toHaveBeenCalledWith('ticker');
});

test('a failed summary shows the error and Try again refetches', async () => {
  portfolioSummary.mockRejectedValueOnce(new Error('Server error'));
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('Server error')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('$12,345.67')).toBeTruthy();
});

test('changing the dimension requests that allocation', async () => {
  await renderWithClient(<DashboardScreen />);
  await screen.findByText('donut:AAPL,NVDA');
  allocation.mockResolvedValue([slice('Technology', 100, 0)]);
  await fireEvent.press(screen.getByRole('button', { name: 'Sector' }));
  await waitFor(() => expect(allocation).toHaveBeenCalledWith('sector'));
  expect(await screen.findByText('donut:Technology')).toBeTruthy();
});

test('when nothing is classified, Sector explains how to classify instead of drawing one gray slice', async () => {
  await renderWithClient(<DashboardScreen />);
  await screen.findByText('donut:AAPL,NVDA');
  allocation.mockResolvedValue([slice('Unassigned', 100, 0)]);
  await fireEvent.press(screen.getByRole('button', { name: 'Sector' }));
  expect(await screen.findByText(/None of your positions has a sector yet/)).toBeTruthy();
  expect(screen.queryByText(/donut:Unassigned/)).toBeNull();
});

test('no open positions says so', async () => {
  allocation.mockResolvedValue([]);
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('No open positions to show yet.')).toBeTruthy();
});

test('a failed history request is shown in its card and does not hide the rest', async () => {
  history.mockRejectedValue(new Error('History unavailable'));
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('History unavailable')).toBeTruthy();
  expect(screen.getByText('$12,345.67')).toBeTruthy();
});

test('a failed trades request is not shown as "no trades" and Retry refetches', async () => {
  listTrades.mockRejectedValueOnce(new Error('Trades unavailable'));
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText('Trades unavailable')).toBeTruthy();
  expect(screen.queryByText(/No trades yet/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('NVDA')).toBeTruthy();
});

test('no trades shows the first-run hint', async () => {
  listTrades.mockResolvedValue([]);
  await renderWithClient(<DashboardScreen />);
  expect(await screen.findByText(/No trades yet\. Add your first buy/)).toBeTruthy();
});

test('Add trade opens the add-trade modal', async () => {
  await renderWithClient(<DashboardScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Add trade' }));
  expect(mockPush).toHaveBeenCalledWith('/add-trade');
});
