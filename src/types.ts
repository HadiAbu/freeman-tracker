// Shapes returned by freeman-api (see freeman-api/app/main.py).

export type Side = 'buy' | 'sell';

export type Trade = {
  id: number;
  ticker: string;
  side: Side;
  shares: number;
  price: number;
  fee: number;
  traded_at: string; // YYYY-MM-DD
  note: string | null;
};

export type NewTrade = {
  ticker: string;
  side: Side;
  shares: number;
  price: number;
  fee: number;
  traded_at: string;
  note?: string | null;
};

export type Holding = {
  ticker: string;
  shares: number;
  avg_cost: number;
  cost_basis: number;
  price: number;
  price_source: 'price' | 'trade';
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  name: string | null;
  sector: string | null;
  asset_class: string | null;
};

export type PortfolioSummary = {
  total_value: number;
  total_cost: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  holdings: Holding[];
};

export type AllocationBy = 'ticker' | 'sector' | 'asset_class';

export type AllocationSlice = { label: string; value: number; percent: number };

export type HistoryPoint = { date: string; value: number; cost: number };

export type PricePoint = { id: number; ticker: string; price: number; as_of: string; source: string };

export type HoldingMeta = { name?: string | null; sector?: string | null; asset_class?: string | null };

export type WatchItem = {
  id: number;
  ticker: string;
  name: string | null;
  target_price: number | null;
  note: string | null;
  /** Latest logged price mark, if any. */
  price: number | null;
  /** (target - price) / price * 100; null without both a target and a price. */
  pct_to_target: number | null;
};

export type NewWatch = {
  ticker: string;
  name?: string | null;
  target_price?: number | null;
  note?: string | null;
};

export type NewPrice = { ticker: string; price: number; as_of: string };
