import { useMemo } from 'react';

import { moneyFormatters } from '@/lib/format';
import { usePreferences } from '@/stores/preferences';

/** Money and share-count formatters that honor the "hide balances" preference. */
export function useMoney() {
  const hidden = usePreferences((s) => s.hideBalances);
  return useMemo(() => moneyFormatters(hidden), [hidden]);
}
