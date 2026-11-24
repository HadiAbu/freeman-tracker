import { create } from 'zustand';

/** What the last price refresh did, for the "updated" label. Not persisted: it is about this session. */
type PriceStatus = {
  /** ISO time the server answered, or null if no refresh has succeeded yet. */
  lastFetchedAt: string | null;
  /** Tickers the last refresh could not price. */
  failedCount: number;
  /** The server has no market data provider configured, so do not keep asking. */
  unavailable: boolean;
};

export const usePriceStatus = create<PriceStatus>()(() => ({
  lastFetchedAt: null,
  failedCount: 0,
  unavailable: false,
}));
