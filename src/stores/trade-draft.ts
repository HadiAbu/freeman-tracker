import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { jsonStorage, markSettled, TRADE_DRAFT_KEY } from '@/stores/persist';
import type { Side } from '@/types';

/** What is typed into the add-trade form, kept so a dismissed modal or a killed app loses nothing. */
export type TradeDraft = {
  side: Side;
  ticker: string;
  shares: string;
  price: string;
  fee: string;
  /** null means "today", whenever the form is opened; only a date the user typed is kept. */
  date: string | null;
  note: string;
  sector: string;
  assetClass: string;
};

export const EMPTY_DRAFT: TradeDraft = {
  side: 'buy',
  ticker: '',
  shares: '',
  price: '',
  fee: '',
  date: null,
  note: '',
  sector: '',
  assetClass: '',
};

type TradeDraftState = {
  draft: TradeDraft;
  setDraft: (patch: Partial<TradeDraft>) => void;
  clear: () => void;
};

/** True when nothing has been entered, so there is nothing worth restoring. */
export function isEmptyDraft(d: TradeDraft): boolean {
  return (
    d.side === EMPTY_DRAFT.side &&
    d.date === null &&
    d.ticker === '' &&
    d.shares === '' &&
    d.price === '' &&
    d.fee === '' &&
    d.note === '' &&
    d.sector === '' &&
    d.assetClass === ''
  );
}

const TEXT_FIELDS = ['ticker', 'shares', 'price', 'fee', 'note', 'sector', 'assetClass'] as const;

/** Keep only well-typed fields; anything else falls back to the empty value. */
export function sanitizeDraft(raw: unknown): TradeDraft {
  if (typeof raw !== 'object' || raw === null) return EMPTY_DRAFT;
  const r = raw as Record<string, unknown>;
  const out: TradeDraft = { ...EMPTY_DRAFT };
  if (r.side === 'buy' || r.side === 'sell') out.side = r.side;
  if (typeof r.date === 'string') out.date = r.date;
  for (const k of TEXT_FIELDS) if (typeof r[k] === 'string') out[k] = r[k] as string;
  return out;
}

export const useTradeDraft = create<TradeDraftState>()(
  persist(
    (set) => ({
      draft: EMPTY_DRAFT,
      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
      clear: () => set({ draft: EMPTY_DRAFT }),
    }),
    {
      name: TRADE_DRAFT_KEY,
      version: 1,
      storage: jsonStorage<Pick<TradeDraftState, 'draft'>>(),
      partialize: (s) => ({ draft: s.draft }),
      merge: (persisted, current) => ({
        ...current,
        draft: sanitizeDraft((persisted as { draft?: unknown } | undefined)?.draft),
      }),
      onRehydrateStorage: () => () => markSettled(TRADE_DRAFT_KEY),
    },
  ),
);
