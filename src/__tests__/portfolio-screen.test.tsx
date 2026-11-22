import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import PortfolioScreen from '@/app/(tabs)/portfolio';
import { api } from '@/lib/api';
import { holding, summary } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

// HoldingRow wraps its row in a router Link; the navigation itself is expo-router's job.
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/charts/pnl-bars', () => ({
  PnLBars: ({ holdings }: { holdings: { ticker: string }[] }) => {
    const { Text } = require('react-native');
    return <Text>{`bars:${holdings.map((h) => h.ticker).join(',')}`}</Text>;
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { portfolioSummary: jest.fn() } };
});

const portfolioSummary = api.portfolioSummary as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  portfolioSummary.mockResolvedValue(
    summary({
      holdings: [
        holding({ ticker: 'AAPL', unrealized_pnl: 300, unrealized_pct: 20 }),
        holding({ ticker: 'TSLA', name: null, shares: 4, avg_cost: 250, market_value: 800, unrealized_pnl: -200, unrealized_pct: -20 }),
      ],
    }),
  );
});

test('lists each holding with the direction of its gain or loss in text, not just color', async () => {
  await renderWithClient(<PortfolioScreen />);
  expect(await screen.findByLabelText('AAPL position details')).toBeTruthy();
  expect(screen.getByLabelText('TSLA position details')).toBeTruthy();
  expect(screen.getByText('▲ +$300.00 (+20.00%)')).toBeTruthy();
  expect(screen.getByText('▼ -$200.00 (-20.00%)')).toBeTruthy();
  expect(screen.getByText('bars:AAPL,TSLA')).toBeTruthy();
  expect(screen.getByText('$12,345.67')).toBeTruthy();
});

test('no holdings shows a designed empty state', async () => {
  portfolioSummary.mockResolvedValue(summary({ holdings: [] }));
  await renderWithClient(<PortfolioScreen />);
  expect(await screen.findByText('No holdings yet')).toBeTruthy();
});

test('a failed load shows the error and Try again refetches', async () => {
  portfolioSummary.mockRejectedValueOnce(new Error('Server error'));
  await renderWithClient(<PortfolioScreen />);
  expect(await screen.findByText('Server error')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('AAPL position details')).toBeTruthy();
  expect(portfolioSummary).toHaveBeenCalledTimes(2);
});
