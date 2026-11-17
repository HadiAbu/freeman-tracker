import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { analysisKey, useLatestAnalysis, useRunAnalysis } from '@/hooks/use-analysis';
import { api, ApiError } from '@/lib/api';
import type { Analysis } from '@/types';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { analyze: jest.fn(), latestAnalysis: jest.fn() } };
});

const ANALYSIS = { ticker: 'AAPL', stance: 'hold' } as Analysis;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: Infinity } } });
  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  clients.push(client);
  return { client, Wrap };
}

const clients: QueryClient[] = [];

beforeEach(() => jest.clearAllMocks());

// Clear every client (and use gcTime: Infinity above for mutations) so React Query's
// gc timers do not keep Jest alive after the run.
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

test('a 404 from the server means "no analysis yet" (null), not an error', async () => {
  (api.latestAnalysis as jest.Mock).mockRejectedValue(new ApiError(404, 'No analysis yet'));
  const { Wrap } = wrapper();
  const { result } = await renderHook(() => useLatestAnalysis('AAPL'), { wrapper: Wrap });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toBeNull();
});

test('other errors stay errors', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    (api.latestAnalysis as jest.Mock).mockRejectedValue(new ApiError(500, 'boom'));
    const { Wrap } = wrapper();
    const { result } = await renderHook(() => useLatestAnalysis('AAPL'), { wrapper: Wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
  } finally {
    spy.mockRestore();
  }
});

test('a found analysis is returned', async () => {
  (api.latestAnalysis as jest.Mock).mockResolvedValue(ANALYSIS);
  const { Wrap } = wrapper();
  const { result } = await renderHook(() => useLatestAnalysis('AAPL'), { wrapper: Wrap });
  await waitFor(() => expect(result.current.data).toEqual(ANALYSIS));
});

test('running an analysis posts the ticker and fills the cache', async () => {
  (api.analyze as jest.Mock).mockResolvedValue(ANALYSIS);
  const { client, Wrap } = wrapper();
  const { result } = await renderHook(() => useRunAnalysis('AAPL'), { wrapper: Wrap });
  await act(async () => {
    await result.current.mutateAsync({ refresh: true, personalize: false });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.analyze).toHaveBeenCalledWith({ ticker: 'AAPL', refresh: true, personalize: false });
  expect(client.getQueryData(analysisKey('AAPL'))).toEqual(ANALYSIS);
});
