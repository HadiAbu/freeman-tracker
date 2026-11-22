import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createJSONStorage } from 'zustand/middleware';

/** Device storage for persisted stores (AsyncStorage: works in Expo Go and on web). */
export const jsonStorage = <S>() => createJSONStorage<S>(() => AsyncStorage);

export const PREFERENCES_KEY = 'freeman-preferences';
export const TRADE_DRAFT_KEY = 'freeman-trade-draft';

/** Every persisted store. The app waits for all of them before showing any screen. */
const PERSISTED = [PREFERENCES_KEY, TRADE_DRAFT_KEY] as const;

const settled = new Set<string>();
const listeners = new Set<() => void>();

/**
 * Called from each store's `onRehydrateStorage` callback, which runs on success AND on failure.
 * zustand's own `hasHydrated()` never becomes true when storage throws (corrupt data, a native
 * error), so waiting on it would leave the app blank forever. A store that fails to load simply
 * keeps its defaults.
 */
export function markSettled(name: string) {
  settled.add(name);
  listeners.forEach((l) => l());
}

/** The non-hook form of useStoresSettled, for code outside React and for tests. */
export const areStoresSettled = () => PERSISTED.every((n) => settled.has(n));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * True once every persisted store has finished loading (or failed to). Gate the UI on this so
 * a saved "hide balances" is applied before the first frame: otherwise real amounts would flash
 * on screen at every cold start.
 */
export function useStoresSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    areStoresSettled,
    () => false,
  );
}
