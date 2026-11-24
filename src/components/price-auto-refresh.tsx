import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useRefreshPrices } from '@/hooks/use-market-prices';
import { usePriceStatus } from '@/stores/price-status';

/** Do not hit the provider more often than this, however often the app is reopened. */
export const MIN_AUTO_REFRESH_MS = 5 * 60 * 1000;

/**
 * Refreshes market prices when the app opens and each time it returns to the foreground, at most
 * every five minutes. Renders nothing. Mount it only while signed in.
 */
export function PriceAutoRefresh() {
  const { mutate } = useRefreshPrices();
  const lastAttempt = useRef(0);

  useEffect(() => {
    const run = () => {
      if (usePriceStatus.getState().unavailable) return;
      if (Date.now() - lastAttempt.current < MIN_AUTO_REFRESH_MS) return;
      lastAttempt.current = Date.now();
      mutate();
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [mutate]);

  return null;
}
