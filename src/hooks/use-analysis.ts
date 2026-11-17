import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import type { Analysis } from '@/types';

export const analysisKey = (ticker: string) => ['analysis', ticker] as const;

/** The newest stored analysis, or null when none exists yet. Never triggers a new analysis. */
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
  });
}

/** Runs (or refreshes) the analysis. This is the only call that costs money, so it is explicit. */
export function useRunAnalysis(ticker: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { refresh?: boolean; personalize?: boolean }) => api.analyze({ ticker, ...opts }),
    onSuccess: (analysis) => qc.setQueryData(analysisKey(ticker), analysis),
  });
}
