import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import type { Analysis } from '@/types';

export const analysisKey = (ticker: string) => ['analysis', ticker] as const;

/**
 * The newest stored analysis, or null when none exists yet. Never triggers a new analysis.
 * A stored analysis does not change on the server without a POST, so this never refetches
 * on its own (focus, reconnect, stale time): that would replace what the user is looking at.
 */
export function useLatestAnalysis(ticker: string) {
  return useQuery<Analysis | null>({
    queryKey: analysisKey(ticker),
    queryFn: async () => {
      try {
        return await api.latestAnalysis(ticker);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Runs (or refreshes) the analysis. This is the only call that costs money, so it is explicit.
 * The result is NOT written into the latest-stored query: the screen keeps it as its own
 * state, so a refetch of the stored row (or a thin-news result that is never stored) cannot
 * replace or hide it. The stored query is only marked stale for the next time it is opened.
 */
export function useRunAnalysis(ticker: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { refresh?: boolean; personalize?: boolean }) => api.analyze({ ticker, ...opts }),
    // Not awaited: the mutation must settle as soon as the POST does.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: analysisKey(ticker) });
    },
  });
}
