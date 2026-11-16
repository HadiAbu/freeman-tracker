import React from 'react';

import { Screen } from '@/components/screen';
import { EmptyState } from '@/components/screen-state';

// Watchlist and manual price marks arrive in phase 4.
export default function WatchlistScreen() {
  return (
    <Screen>
      <EmptyState title="Watchlist" hint="Track tickers and target prices — coming soon." />
    </Screen>
  );
}
