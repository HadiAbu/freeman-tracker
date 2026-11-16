import React from 'react';

import { Screen } from '@/components/screen';
import { EmptyState } from '@/components/screen-state';

// Holdings list, allocation charts and position detail arrive in phase 3.
export default function PortfolioScreen() {
  return (
    <Screen>
      <EmptyState title="Portfolio" hint="Holdings and allocation charts are coming next." />
    </Screen>
  );
}
