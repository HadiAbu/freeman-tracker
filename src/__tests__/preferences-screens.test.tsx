import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import DashboardScreen from '@/app/(tabs)/index';
import TradesScreen from '@/app/(tabs)/trades';
import AnalysisScreen from '@/app/analysis/[ticker]';
import { api } from '@/lib/api';
import { usePreferences } from '@/stores/preferences';
import { summary, trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ ticker: 'AAPL' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));
jest.mock('@/components/charts/trend-line', () => ({ TrendLine: () => null }));
jest.mock('@/components/charts/allocation-donut', () => ({
  AllocationDonut: ({ slices }: { slices: { label: string }[] }) => {
    const { Text } = require('react-native');
    return <Text>{`donut:${slices.map((s) => s.label).join(',')}`}</Text>;
  },
}));
// The analysis screen is driven through its hooks, as in analysis-screen.test.tsx.
const mockRunMutate = jest.fn();
let mockHeld = true;
jest.mock('@/hooks/use-analysis', () => ({
  useLatestAnalysis: () => ({ data: null, isPending: false, isError: false, refetch: jest.fn() }),
  useRunAnalysis: () => ({ mutate: mockRunMutate, isPending: false, isError: false, error: null }),
}));
// One mock serves the dashboard too, so it returns a complete summary, not just the holdings.
jest.mock('@/hooks/use-trades', () => ({
  ...jest.requireActual('@/hooks/use-trades'),
  usePortfolioSummary: () => {
    const { summary, holding } = require('@/test-utils/fixtures');
    return {
      data: summary({ holdings: mockHeld ? [holding({ ticker: 'AAPL' })] : [] }),
      isPending: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: { portfolioSummary: jest.fn(), listTrades: jest.fn(), history: jest.fn(), allocation: jest.fn() },
  };
});

const allocation = api.allocation as jest.Mock;
const listTrades = api.listTrades as jest.Mock;
const slice = (label: string) => ({ label, value: 1, percent: 100, slot: 0 });
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  mockHeld = true;
  (api.portfolioSummary as jest.Mock).mockResolvedValue(summary());
  (api.history as jest.Mock).mockResolvedValue([]);
  allocation.mockImplementation(async (by: string) => [slice(by)]);
  listTrades.mockResolvedValue([trade({ id: 1, ticker: 'NVDA' })]);
});

describe('dashboard allocation view', () => {
  test('opens on Ticker by default', async () => {
    await renderWithClient(<DashboardScreen />);
    expect(await screen.findByText('donut:ticker')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ticker' })).toBeSelected();
  });

  test('opens on the view chosen last time', async () => {
    usePreferences.setState({ allocationBy: 'asset_class' });
    await renderWithClient(<DashboardScreen />);
    expect(await screen.findByText('donut:asset_class')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Asset class' })).toBeSelected();
    expect(allocation).not.toHaveBeenCalledWith('ticker');
  });

  test('choosing a view saves it', async () => {
    await renderWithClient(<DashboardScreen />);
    await screen.findByText('donut:ticker');
    await fireEvent.press(screen.getByRole('button', { name: 'Sector' }));
    expect(usePreferences.getState().allocationBy).toBe('sector');
    await flush();
    expect(JSON.parse((await AsyncStorage.getItem('freeman-preferences'))!).state.allocationBy).toBe('sector');
    // let the new view finish loading so nothing updates after the test ends
    expect(await screen.findByText('donut:sector')).toBeTruthy();
  });

  test('a saved value that is no longer valid falls back to Ticker instead of breaking the screen', async () => {
    await AsyncStorage.setItem(
      'freeman-preferences',
      JSON.stringify({ state: { allocationBy: 'region' }, version: 1 }),
    );
    await act(async () => {
      await usePreferences.persist.rehydrate();
    });
    await renderWithClient(<DashboardScreen />);
    expect(await screen.findByText('donut:ticker')).toBeTruthy();
  });
});

describe('trades filter', () => {
  test('opens on All by default and asks for every side', async () => {
    await renderWithClient(<TradesScreen />);
    await screen.findByText('NVDA');
    expect(listTrades).toHaveBeenCalledWith({ side: undefined, limit: 100, offset: 0 });
    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
  });

  test('opens on the filter chosen last time and asks the server for only that side', async () => {
    usePreferences.setState({ tradesSide: 'sell' });
    await renderWithClient(<TradesScreen />);
    await screen.findByText('NVDA');
    expect(listTrades).toHaveBeenCalledWith({ side: 'sell', limit: 100, offset: 0 });
    expect(listTrades).not.toHaveBeenCalledWith(expect.objectContaining({ side: undefined }));
    expect(screen.getByRole('button', { name: 'Sells' })).toBeSelected();
  });

  test('choosing a filter saves it, and All clears it', async () => {
    await renderWithClient(<TradesScreen />);
    await screen.findByText('NVDA');
    await fireEvent.press(screen.getByRole('button', { name: 'Buys' }));
    expect(usePreferences.getState().tradesSide).toBe('buy');
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    expect(usePreferences.getState().tradesSide).toBeNull();
    await waitFor(() => expect(listTrades).toHaveBeenLastCalledWith({ side: undefined, limit: 100, offset: 0 }));
  });
});

describe('analysis: "Use my position"', () => {
  const toggle = () => screen.getByLabelText('Use my position');

  test('starts on, and the first Analyze personalizes', async () => {
    await render(<AnalysisScreen />);
    expect(toggle().props.value).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Analyze with news' }));
    expect(mockRunMutate).toHaveBeenCalledWith({ personalize: true }, expect.any(Object));
  });

  test('starts where the user last left it, on a ticker with no analysis yet', async () => {
    usePreferences.setState({ personalizeDefault: false });
    await render(<AnalysisScreen />);
    expect(toggle().props.value).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Analyze with news' }));
    expect(mockRunMutate).toHaveBeenCalledWith({ personalize: false }, expect.any(Object));
  });

  test('flipping it remembers the choice for the next ticker', async () => {
    await render(<AnalysisScreen />);
    await fireEvent(toggle(), 'valueChange', false);
    expect(usePreferences.getState().personalizeDefault).toBe(false);
  });

  test('a ticker that is not held has no switch and does not personalize', async () => {
    mockHeld = false;
    await render(<AnalysisScreen />);
    expect(screen.queryByLabelText('Use my position')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Analyze with news' }));
    expect(mockRunMutate).toHaveBeenCalledWith({ personalize: false }, expect.any(Object));
  });
});
