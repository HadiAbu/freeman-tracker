import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useTradeDraft } from '@/stores/trade-draft';
import type { HoldingMeta, NewTrade, Side } from '@/types';

// Every trades query lives under ['trades'], so one invalidation refreshes all of them.
export const tradeKeys = {
  all: ['trades'] as const,
  recent: (limit: number) => ['trades', 'recent', limit] as const,
  paged: (side?: Side) => ['trades', 'paged', side ?? 'all'] as const,
  ticker: (ticker: string) => ['trades', 'ticker', ticker] as const,
};
export const portfolioKey = ['portfolio'] as const;

export const TRADES_PAGE_SIZE = 100;

/** The newest `limit` trades (dashboard). */
export function useRecentTrades(limit = 5) {
  return useQuery({
    queryKey: tradeKeys.recent(limit),
    queryFn: () => api.listTrades({ limit }),
  });
}

/** Full trade history, newest first, loaded a page at a time (Trades tab). */
export function useTradePages(side?: Side) {
  return useInfiniteQuery({
    queryKey: tradeKeys.paged(side),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listTrades({ side, limit: TRADES_PAGE_SIZE, offset: pageParam }),
    // A short page means there is nothing more to load.
    getNextPageParam: (last, all) =>
      last.length < TRADES_PAGE_SIZE ? undefined : all.length * TRADES_PAGE_SIZE,
  });
}

/** Every trade for one ticker (position screen): filtered by the server, not the client. */
export function useTickerTrades(ticker: string) {
  return useQuery({
    queryKey: tradeKeys.ticker(ticker),
    queryFn: () => api.listTrades({ ticker, limit: 1000 }),
  });
}

export function usePortfolioSummary() {
  return useQuery({ queryKey: [...portfolioKey, 'summary'], queryFn: api.portfolioSummary });
}

// A trade changes both the trade list and everything derived from it.
function useInvalidateAfterTradeChange() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: tradeKeys.all }),
      qc.invalidateQueries({ queryKey: portfolioKey }),
    ]);
}

export function useCreateTrade() {
  const invalidate = useInvalidateAfterTradeChange();
  return useMutation({ mutationFn: (t: NewTrade) => api.createTrade(t), onSuccess: invalidate });
}

/**
 * Creates the trade and, when the user typed a sector / asset class, saves ONLY those fields
 * with a partial update. It is one mutationFn so the classification is still saved if the
 * screen unmounts mid-request. A failed classification never fails the trade: the result
 * carries `classificationFailed` so the screen can tell the user.
 */
export function useCreateTradeWithClassification() {
  const invalidate = useInvalidateAfterTradeChange();
  return useMutation({
    mutationFn: async ({
      trade,
      classification,
    }: {
      trade: NewTrade;
      classification: HoldingMeta | null;
    }) => {
      const created = await api.createTrade(trade);
      let classificationFailed = false;
      if (classification) {
        try {
          await api.patchHolding(trade.ticker, classification);
        } catch {
          classificationFailed = true;
        }
      }
      return { trade: created, classificationFailed };
    },
    onSuccess: () => {
      // Cleared here, not in the screen: this runs even when the screen has been dismissed
      // mid-request, so a saved trade can never come back as a draft to be saved twice.
      useTradeDraft.getState().clear();
      return invalidate();
    },
  });
}

export function useDeleteTrade() {
  const invalidate = useInvalidateAfterTradeChange();
  return useMutation({ mutationFn: (id: number) => api.deleteTrade(id), onSuccess: invalidate });
}
