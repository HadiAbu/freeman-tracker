import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { useRefreshPrices } from '@/hooks/use-market-prices';
import { ApiError, api } from '@/lib/api';
import { usePriceStatus } from '@/stores/price-status';
import { createTestClient } from '@/test-utils/render';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { refreshPrices: jest.fn() } };
});
const refreshPrices = api.refreshPrices as jest.Mock;

const setup = async () => {
  const client = createTestClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useRefreshPrices(), { wrapper });
  return { invalidate, ...hook };
};

beforeEach(() => {
  jest.clearAllMocks();
  usePriceStatus.setState({ lastFetchedAt: null, failedCount: 0, unavailable: false });
});

test('a refresh records when it happened and reloads portfolio, watchlist and price history', async () => {
  refreshPrices.mockResolvedValue({
    updated: [{ ticker: 'AAPL', price: 190, as_of: '2026-11-24' }],
    failed: [{ ticker: 'ZZZZ', reason: 'no quote for this symbol' }],
    from_cache: 0,
    fetched_at: '2026-11-24T15:00:00Z',
  });
  const { result, invalidate } = await setup();
  await act(async () => {
    await result.current.mutateAsync();
  });
  expect(usePriceStatus.getState()).toMatchObject({
    lastFetchedAt: '2026-11-24T15:00:00Z',
    failedCount: 1,
    unavailable: false,
  });
  const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
  expect(keys).toEqual(expect.arrayContaining(['portfolio', 'watchlist', 'prices']));
});

test('a 503 marks live prices as unavailable instead of surfacing an error', async () => {
  refreshPrices.mockRejectedValue(new ApiError(503, 'Market prices are not configured'));
  const { result } = await setup();
  await act(async () => {
    await result.current.mutateAsync().catch(() => undefined);
  });
  await waitFor(() => expect(usePriceStatus.getState().unavailable).toBe(true));
});

test('any other failure leaves the status alone so old prices stay on screen', async () => {
  usePriceStatus.setState({ lastFetchedAt: '2026-11-24T09:00:00Z' });
  refreshPrices.mockRejectedValue(new ApiError(0, 'Could not reach the server'));
  const { result } = await setup();
  await act(async () => {
    await result.current.mutateAsync().catch(() => undefined);
  });
  expect(usePriceStatus.getState()).toMatchObject({
    lastFetchedAt: '2026-11-24T09:00:00Z',
    unavailable: false,
  });
});
