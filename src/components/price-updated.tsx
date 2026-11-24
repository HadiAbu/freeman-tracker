import React from 'react';

import { ThemedText } from '@/components/themed-text';
import { usePriceStatus } from '@/stores/price-status';

/** "Prices updated 3:42 PM", plus a note when some tickers could not be priced. Renders nothing before the first refresh. */
export function PriceUpdated() {
  const lastFetchedAt = usePriceStatus((s) => s.lastFetchedAt);
  const failedCount = usePriceStatus((s) => s.failedCount);
  const unavailable = usePriceStatus((s) => s.unavailable);

  if (unavailable) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Live prices are not set up on the server. Showing the prices you entered.
      </ThemedText>
    );
  }
  if (!lastFetchedAt) return null;

  const time = new Date(lastFetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const note = failedCount > 0 ? ` · ${failedCount} could not be updated` : '';
  return (
    <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
      Prices updated {time}
      {note}
    </ThemedText>
  );
}
