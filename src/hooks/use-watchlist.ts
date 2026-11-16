import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { portfolioKey } from '@/hooks/use-trades';
import { api } from '@/lib/api';
import type { NewPrice, NewWatch } from '@/types';

export const watchlistKey = ['watchlist'] as const;

export function useWatchlist() {
  return useQuery({ queryKey: watchlistKey, queryFn: api.listWatchlist });
}

export function useAddWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: NewWatch) => api.addWatch(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKey }),
  });
}

export function useDeleteWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteWatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKey }),
  });
}

/**
 * A price mark revalues holdings and updates watchlist gain-to-target, so it
 * invalidates the portfolio, the watchlist and that ticker's price history.
 */
export function useAddPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: NewPrice) => api.addPrice(p),
    onSuccess: (_data, p) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: portfolioKey }),
        qc.invalidateQueries({ queryKey: watchlistKey }),
        qc.invalidateQueries({ queryKey: ['prices', p.ticker] }),
      ]),
  });
}
