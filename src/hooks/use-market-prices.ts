import { useMutation, useQueryClient } from '@tanstack/react-query';

import { portfolioKey } from '@/hooks/use-trades';
import { watchlistKey } from '@/hooks/use-watchlist';
import { ApiError, api } from '@/lib/api';
import { usePriceStatus } from '@/stores/price-status';

/**
 * Fetch current market prices, then reload everything that shows a price. A failure is quiet by
 * design: the screens keep the last known prices (labelled with their date), so a provider outage
 * or a missing server setting never replaces them with an error.
 */
export function useRefreshPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.refreshPrices,
    onSuccess: (result) => {
      usePriceStatus.setState({
        lastFetchedAt: result.fetched_at,
        failedCount: result.failed.length,
        unavailable: false,
      });
      qc.invalidateQueries({ queryKey: portfolioKey });
      qc.invalidateQueries({ queryKey: watchlistKey });
      qc.invalidateQueries({ queryKey: ['prices'] });
    },
    onError: (e) => {
      // 503 means the server has no provider key: stop trying until the app restarts.
      if (e instanceof ApiError && e.status === 503) usePriceStatus.setState({ unavailable: true });
    },
  });
}
