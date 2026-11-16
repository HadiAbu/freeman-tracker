import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { NewTrade, Side } from '@/types';

export const tradeKeys = {
  all: ['trades'] as const,
  list: (side?: Side) => ['trades', { side: side ?? 'all' }] as const,
};
export const portfolioKey = ['portfolio'] as const;

export function useTrades(side?: Side) {
  return useQuery({ queryKey: tradeKeys.list(side), queryFn: () => api.listTrades({ side }) });
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

export function useDeleteTrade() {
  const invalidate = useInvalidateAfterTradeChange();
  return useMutation({ mutationFn: (id: number) => api.deleteTrade(id), onSuccess: invalidate });
}
