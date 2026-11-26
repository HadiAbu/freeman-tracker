import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import DashboardScreen from '@/app/(tabs)/index';
import PortfolioScreen from '@/app/(tabs)/portfolio';
import TradesScreen from '@/app/(tabs)/trades';
import HoldingScreen from '@/app/holding/[ticker]';
import { api } from '@/lib/api';
import { holding, summary, trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';
import { usePreferences } from '@/stores/preferences';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ ticker: 'AAPL' }),
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));
// Charts draw SVG. These stand-ins print what the chart would label, using the same formatter
// hook the real charts use, so a leak through a chart would show up as readable text.
jest.mock('@/components/charts/trend-line', () => ({
  TrendLine: ({ sensitive }: { sensitive?: boolean }) => {
    const { Text } = require('react-native');
    const { useMoney } = require('@/hooks/use-money');
    const money = useMoney();
    return <Text>{`trend:${sensitive && money.hidden ? 'masked' : 'plain'}`}</Text>;
  },
}));
jest.mock('@/components/charts/allocation-donut', () => ({
  AllocationDonut: ({ total }: { total: number }) => {
    const { Text } = require('react-native');
    const { useMoney } = require('@/hooks/use-money');
    return <Text>{`donut-total:${useMoney().currency(total)}`}</Text>;
  },
}));
jest.mock('@/components/charts/pnl-bars', () => ({
  PnLBars: () => {
    const { Text } = require('react-native');
    const { useMoney } = require('@/hooks/use-money');
    return <Text>{`bars-axis:${useMoney().compactCurrency(1500)}`}</Text>;
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
      priceHistory: jest.fn(),
    },
  };
});

const hide = () => usePreferences.setState({ hideBalances: true });
const MASKED = '••••';

beforeEach(() => {
  jest.clearAllMocks();
  (api.portfolioSummary as jest.Mock).mockResolvedValue(summary());
  (api.listTrades as jest.Mock).mockResolvedValue([
    trade({ id: 1, ticker: 'AAPL', shares: 2, price: 100, fee: 1 }),
  ]);
  (api.history as jest.Mock).mockResolvedValue([
    { date: '2026-10-01', value: 100, cost: 90 },
    { date: '2026-11-01', value: 120, cost: 90 },
  ]);
  (api.allocation as jest.Mock).mockResolvedValue([
    { label: 'AAPL', value: 100, percent: 100, slot: 0 },
  ]);
  (api.priceHistory as jest.Mock).mockResolvedValue([]);
});

describe('dashboard', () => {
  test('shows real amounts by default', async () => {
    await renderWithClient(<DashboardScreen />);
    expect(await screen.findByText('$12,345.67')).toBeTruthy();
    expect(screen.getByText('donut-total:$12,345.67')).toBeTruthy();
    expect(screen.getByText('trend:plain')).toBeTruthy();
  });

  test('hidden: no amount is readable anywhere, but gain and loss percentages still are', async () => {
    hide();
    await renderWithClient(<DashboardScreen />);
    expect(await screen.findByText(`${MASKED} (+11.11%) unrealized`)).toBeTruthy();
    expect(screen.getByText(`Cost ${MASKED} · Realized ${MASKED}`)).toBeTruthy();
    expect(screen.getByText(`donut-total:${MASKED}`)).toBeTruthy();
    expect(screen.getByText('trend:masked')).toBeTruthy();
    // a recent trade: share count and total hidden, the market price per share is not private
    expect(screen.getByText(/^•••• × \$100\.00 · 2026-11-01$/)).toBeTruthy();
    expect(screen.queryByText(/\$12,345\.67/)).toBeNull();
    expect(screen.queryByText(/\$1,234\.56/)).toBeNull();
    expect(screen.queryByText('$201.00')).toBeNull();
  });

  test('the eye button hides and reveals live, without leaving the screen', async () => {
    await renderWithClient(<DashboardScreen />);
    await screen.findByText('$12,345.67');
    await fireEvent.press(screen.getByRole('switch', { name: 'Hide balances' }));
    expect(screen.queryByText('$12,345.67')).toBeNull();
    expect(screen.getByText(`${MASKED} (+11.11%) unrealized`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('switch', { name: 'Hide balances' }));
    expect(await screen.findByText('$12,345.67')).toBeTruthy();
  });
});

describe('portfolio', () => {
  test('hidden: total, holding value, cost and gain are masked; the percentage is not', async () => {
    (api.portfolioSummary as jest.Mock).mockResolvedValue(
      summary({
        holdings: [holding({ ticker: 'AAPL', name: 'Apple Inc.', shares: 10, avg_cost: 150 })],
      }),
    );
    hide();
    await renderWithClient(<PortfolioScreen />);
    expect(await screen.findByText(`Apple Inc. · ${MASKED} @ ${MASKED}`)).toBeTruthy();
    expect(screen.getByText(`▲ ${MASKED} (+20.00%)`)).toBeTruthy();
    expect(screen.getByText(`bars-axis:${MASKED}`)).toBeTruthy();
    expect(screen.queryByText(/\$12,345\.67/)).toBeNull();
    expect(screen.queryByText(/\$1,800\.00/)).toBeNull();
  });

  test('the eye button is on this screen too', async () => {
    await renderWithClient(<PortfolioScreen />);
    await screen.findByText('$12,345.67');
    await fireEvent.press(screen.getByRole('switch', { name: 'Hide balances' }));
    expect(screen.queryByText('$12,345.67')).toBeNull();
  });
});

describe('position screen', () => {
  beforeEach(() => {
    (api.listTrades as jest.Mock).mockResolvedValue([trade({ id: 7, ticker: 'AAPL', price: 150 })]);
  });

  test('hidden: value, shares, cost and realized are masked; the market price is not', async () => {
    hide();
    await renderWithClient(<HoldingScreen />);
    expect(await screen.findByText(`▲ ${MASKED} (+20.00%)`)).toBeTruthy();
    // Shares, Avg cost, Cost basis and Realized
    expect(screen.getAllByText(MASKED).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('$1,800.00')).toBeNull();
    expect(screen.queryByText('$1,500.00')).toBeNull();
    // the ticker's price is public information, so it stays readable
    expect(screen.getByText('$180.00')).toBeTruthy();
  });

  test('shown: real amounts', async () => {
    await renderWithClient(<HoldingScreen />);
    expect(await screen.findByText('$1,800.00')).toBeTruthy();
    expect(screen.getByText('$1,500.00')).toBeTruthy();
  });
});

describe('trades tab', () => {
  test('hidden: share counts and totals are masked; the price per share is not', async () => {
    (api.listTrades as jest.Mock).mockResolvedValue([
      trade({ id: 1, ticker: 'NVDA', shares: 2, price: 100, fee: 1 }),
    ]);
    hide();
    await renderWithClient(<TradesScreen />);
    expect(await screen.findByText(/^•••• × \$100\.00 · 2026-11-01$/)).toBeTruthy();
    expect(screen.queryByText('$201.00')).toBeNull();
  });
});
