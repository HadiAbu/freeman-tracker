import { render } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';

import { MIN_AUTO_REFRESH_MS, PriceAutoRefresh } from '@/components/price-auto-refresh';
import { usePriceStatus } from '@/stores/price-status';

const mockMutate = jest.fn();
jest.mock('@/hooks/use-market-prices', () => ({ useRefreshPrices: () => ({ mutate: mockMutate }) }));

let onChange: (state: string) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  usePriceStatus.setState({ lastFetchedAt: null, failedCount: 0, unavailable: false });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    onChange = handler as (state: string) => void;
    return { remove } as never;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('refreshes once when it appears', async () => {
  await render(<PriceAutoRefresh />);
  expect(mockMutate).toHaveBeenCalledTimes(1);
});

test('refreshes when the app returns to the foreground, but not more often than every five minutes', async () => {
  await render(<PriceAutoRefresh />);
  onChange('active');
  expect(mockMutate).toHaveBeenCalledTimes(1); // too soon

  jest.setSystemTime(Date.now() + MIN_AUTO_REFRESH_MS + 1);
  onChange('background');
  expect(mockMutate).toHaveBeenCalledTimes(1); // only "active" counts
  onChange('active');
  expect(mockMutate).toHaveBeenCalledTimes(2);
});

test('stops asking once the server says live prices are not set up', async () => {
  usePriceStatus.setState({ unavailable: true });
  await render(<PriceAutoRefresh />);
  expect(mockMutate).not.toHaveBeenCalled();
});

test('removes its foreground listener when it goes away', async () => {
  const view = await render(<PriceAutoRefresh />);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});
