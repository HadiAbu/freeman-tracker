import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { useAllocation } from '@/hooks/use-portfolio';
import {
  useCreateTrade,
  useCreateTradeWithClassification,
  useDeleteTrade,
  useTradePages,
} from '@/hooks/use-trades';
import { useAddPrice, useAddWatch, useDeleteWatch } from '@/hooks/use-watchlist';
import { api } from '@/lib/api';
import { trade } from '@/test-utils/fixtures';
import { createTestClient } from '@/test-utils/render';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: {
      createTrade: jest.fn(),
      deleteTrade: jest.fn(),
      patchHolding: jest.fn(),
      listTrades: jest.fn(),
      addWatch: jest.fn(),
      deleteWatch: jest.fn(),
      addPrice: jest.fn(),
      allocation: jest.fn(),
    },
  };
});

const mocked = api as unknown as Record<string, jest.Mock>;

async function setup<T>(hook: () => T) {
  const client = createTestClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = await renderHook(hook, { wrapper });
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
  return { client, invalidatedKeys, ...view };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mocked).forEach((fn) => fn.mockResolvedValue({}));
});

describe('trade mutations refresh the trade lists and everything derived from them', () => {
  test('useCreateTrade', async () => {
    const { result, invalidatedKeys } = await setup(() => useCreateTrade());
    await act(async () => {
      await result.current.mutateAsync(trade());
    });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['trades'], ['portfolio']]));
  });

  test('useDeleteTrade', async () => {
    const { result, invalidatedKeys } = await setup(() => useDeleteTrade());
    await act(async () => {
      await result.current.mutateAsync(3);
    });
    expect(mocked.deleteTrade).toHaveBeenCalledWith(3);
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['trades'], ['portfolio']]));
  });

  test('useCreateTradeWithClassification reports a failed classification without failing the trade', async () => {
    mocked.createTrade.mockResolvedValue({ id: 9 });
    mocked.patchHolding.mockRejectedValue(new Error('nope'));
    const { result, invalidatedKeys } = await setup(() => useCreateTradeWithClassification());
    let out: { classificationFailed: boolean } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        trade: trade({ ticker: 'NVDA' }),
        classification: { sector: 'Tech' },
      });
    });
    expect(out?.classificationFailed).toBe(true);
    // the trade was saved, so the lists still refresh
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['trades'], ['portfolio']]));
  });

  test('a failed trade does not refresh anything', async () => {
    mocked.createTrade.mockRejectedValue(new Error('rejected'));
    const { result, invalidatedKeys } = await setup(() => useCreateTrade());
    await act(async () => {
      await result.current.mutateAsync(trade()).catch(() => {});
    });
    expect(invalidatedKeys()).toEqual([]);
  });
});

describe('watchlist and price mutations', () => {
  test('adding and removing a watch refreshes the watchlist', async () => {
    const add = await setup(() => useAddWatch());
    await act(async () => {
      await add.result.current.mutateAsync({ ticker: 'AAPL' });
    });
    expect(add.invalidatedKeys()).toEqual([['watchlist']]);

    const del = await setup(() => useDeleteWatch());
    await act(async () => {
      await del.result.current.mutateAsync(1);
    });
    expect(del.invalidatedKeys()).toEqual([['watchlist']]);
  });

  test('logging a price refreshes the portfolio, the watchlist and that ticker only', async () => {
    const { result, invalidatedKeys } = await setup(() => useAddPrice());
    await act(async () => {
      await result.current.mutateAsync({ ticker: 'AAPL', price: 10, as_of: '2026-11-01' });
    });
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([['portfolio'], ['watchlist'], ['prices', 'AAPL']]),
    );
    expect(invalidatedKeys()).toHaveLength(3);
  });
});

describe('useTradePages', () => {
  const page = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => trade({ id: from + i }));

  test('a full page leads to a next page at the next offset; a short page ends the list', async () => {
    mocked.listTrades.mockResolvedValueOnce(page(100)).mockResolvedValueOnce(page(3, 101));
    const { result } = await setup(() => useTradePages('buy'));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(mocked.listTrades).toHaveBeenLastCalledWith({ side: 'buy', limit: 100, offset: 0 });

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mocked.listTrades).toHaveBeenLastCalledWith({ side: 'buy', limit: 100, offset: 100 });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.flat()).toHaveLength(103);
  });

  test('side filters are cached separately', async () => {
    mocked.listTrades.mockResolvedValue(page(1));
    const { client } = await setup(() => useTradePages('sell'));
    await waitFor(() => expect(client.getQueryData(['trades', 'paged', 'sell'])).toBeDefined());
    expect(client.getQueryData(['trades', 'paged', 'all'])).toBeUndefined();
  });
});

describe('useAllocation', () => {
  test('keeps the previous slices while another dimension loads', async () => {
    const tickerSlices = [{ label: 'AAPL', value: 1, percent: 100, slot: 0 }];
    mocked.allocation.mockResolvedValueOnce(tickerSlices);
    let release: (v: unknown) => void = () => {};
    mocked.allocation.mockReturnValueOnce(new Promise((r) => (release = r)));

    const { result } = await setup(() => {
      const [by, setBy] = React.useState<'ticker' | 'sector'>('ticker');
      return { q: useAllocation(by), setBy };
    });
    await waitFor(() => expect(result.current.q.data).toEqual(tickerSlices));

    await act(async () => result.current.setBy('sector'));
    expect(result.current.q.data).toEqual(tickerSlices);
    expect(result.current.q.isPlaceholderData).toBe(true);

    await act(async () => release([{ label: 'Tech', value: 1, percent: 100, slot: 0 }]));
    await waitFor(() => expect(result.current.q.isPlaceholderData).toBe(false));
    expect(result.current.q.data?.[0].label).toBe('Tech');
  });
});
