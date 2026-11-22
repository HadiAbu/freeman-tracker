import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { jsonStorage, markSettled, PREFERENCES_KEY } from '@/stores/persist';
import type { AllocationBy, Side } from '@/types';

/** Settings the user chose that should still be there next time the app opens. */
export type PreferencesData = {
  /** Mask every amount of money and share count (for using the app in public). */
  hideBalances: boolean;
  /** Dashboard allocation view. */
  allocationBy: AllocationBy;
  /** Trades tab filter; null is "All". */
  tradesSide: Side | null;
  /** Starting value of "Use my position" on the analysis screen for a ticker with no analysis yet. */
  personalizeDefault: boolean;
};

export const DEFAULT_PREFERENCES: PreferencesData = {
  hideBalances: false,
  allocationBy: 'ticker',
  tradesSide: null,
  personalizeDefault: true,
};

type PreferencesActions = {
  toggleHideBalances: () => void;
  setAllocationBy: (by: AllocationBy) => void;
  setTradesSide: (side: Side | null) => void;
  setPersonalizeDefault: (value: boolean) => void;
};

const ALLOCATION: readonly AllocationBy[] = ['ticker', 'sector', 'asset_class'];

/**
 * Keep only values of the right type. Stored data can be from an older version of the app or
 * edited by hand, and a bad value (say an unknown allocation view) must fall back to the default
 * instead of crashing a screen.
 */
export function sanitizePreferences(raw: unknown): Partial<PreferencesData> {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PreferencesData> = {};
  if (typeof r.hideBalances === 'boolean') out.hideBalances = r.hideBalances;
  if (ALLOCATION.includes(r.allocationBy as AllocationBy)) out.allocationBy = r.allocationBy as AllocationBy;
  if (r.tradesSide === null || r.tradesSide === 'buy' || r.tradesSide === 'sell') out.tradesSide = r.tradesSide;
  if (typeof r.personalizeDefault === 'boolean') out.personalizeDefault = r.personalizeDefault;
  return out;
}

export const usePreferences = create<PreferencesData & PreferencesActions>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      toggleHideBalances: () => set((s) => ({ hideBalances: !s.hideBalances })),
      setAllocationBy: (allocationBy) => set({ allocationBy }),
      setTradesSide: (tradesSide) => set({ tradesSide }),
      setPersonalizeDefault: (personalizeDefault) => set({ personalizeDefault }),
    }),
    {
      name: PREFERENCES_KEY,
      version: 1,
      storage: jsonStorage<PreferencesData>(),
      // functions are not data: store only the settings
      partialize: (s): PreferencesData => ({
        hideBalances: s.hideBalances,
        allocationBy: s.allocationBy,
        tradesSide: s.tradesSide,
        personalizeDefault: s.personalizeDefault,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePreferences(persisted) }),
      onRehydrateStorage: () => () => markSettled(PREFERENCES_KEY),
    },
  ),
);
