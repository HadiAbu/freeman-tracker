import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { portfolioKey } from '@/hooks/use-trades';
import { api } from '@/lib/api';
import type { AllocationBy, HoldingMeta } from '@/types';

export function useAllocation(by: AllocationBy) {
  return useQuery({
    queryKey: [...portfolioKey, 'allocation', by],
    queryFn: () => api.allocation(by),
    // Keep the previous slices on screen while another dimension loads (no flash).
    placeholderData: (prev) => prev,
  });
}

export function usePortfolioHistory() {
  return useQuery({ queryKey: [...portfolioKey, 'history'], queryFn: api.history });
}

export function usePriceHistory(ticker: string) {
  return useQuery({
    queryKey: ['prices', ticker],
    queryFn: () => api.priceHistory(ticker),
  });
}

export function useSaveHoldingMeta(ticker: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meta: HoldingMeta) => api.putHolding(ticker, meta),
    // Sector / asset class feed the summary and every allocation view.
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioKey }),
  });
}
