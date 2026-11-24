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

export type PriceKind = 'manual' | 'market' | 'trade';

export type Holding = {
  ticker: string;
  shares: number;
  avg_cost: number;
  cost_basis: number;
  price: number;
  price_source: 'price' | 'trade';
  /** Day of the price mark behind `price`; null when it is the last trade price. */
  price_as_of: string | null;
  /** manual: typed by the user; market: fetched from the provider; trade: fallback to the last trade. */
  price_kind: PriceKind;
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

/** `slot` is a stable identity index for the label (from the server), mapped to a palette color. */
export type AllocationSlice = { label: string; value: number; percent: number; slot: number };

export type HistoryPoint = { date: string; value: number; cost: number };

export type PricePoint = { id: number; ticker: string; price: number; as_of: string; source: string };

export type HoldingMeta = { name?: string | null; sector?: string | null; asset_class?: string | null };

export type WatchItem = {
  id: number;
  ticker: string;
  name: string | null;
  target_price: number | null;
  note: string | null;
  /** Latest price mark, if any. */
  price: number | null;
  price_as_of: string | null;
  price_kind: PriceKind | null;
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

export type Stance = 'buy' | 'hold' | 'sell' | 'unclear';
export type Confidence = 'low' | 'medium' | 'high';

export type CasePoint = { point: string; source_ids: string[] };

export type AnalysisSource = {
  id: string;
  title: string;
  source: string;
  published_at: string | null;
  url: string;
  origin: 'finnhub_company' | 'finnhub_market' | 'gdelt';
};

export type Analysis = {
  ticker: string;
  generated_at: string;
  cached: boolean;
  personalized: boolean;
  stance: Stance;
  confidence: Confidence;
  summary: string;
  case_for: CasePoint[];
  case_against: CasePoint[];
  watch_for: string[];
  sources: AnalysisSource[];
  notes: string[];
  model: string;
};

export type AnalysisRequest = { ticker: string; refresh?: boolean; personalize?: boolean };

export type PriceRefreshResult = {
  updated: { ticker: string; price: number; as_of: string }[];
  /** Tickers the provider could not price; they keep their last known price. */
  failed: { ticker: string; reason: string }[];
  from_cache: number;
  fetched_at: string;
};
