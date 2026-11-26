import { todayISO } from '@/lib/format';
import type { Holding, PortfolioSummary, Trade, WatchItem } from '@/types';

export const trade = (over: Partial<Trade> = {}): Trade => ({
  id: 1,
  ticker: 'NVDA',
  side: 'buy',
  shares: 2,
  price: 100,
  fee: 0,
  traded_at: '2026-11-01',
  note: null,
  ...over,
});

export const holding = (over: Partial<Holding> = {}): Holding => ({
  ticker: 'AAPL',
  shares: 10,
  avg_cost: 150,
  cost_basis: 1500,
  price: 180,
  price_source: 'price',
  price_as_of: todayISO(), // today, so a fixture price is never flagged stale
  price_kind: 'manual',
  market_value: 1800,
  unrealized_pnl: 300,
  unrealized_pct: 20,
  realized_pnl: 0,
  name: 'Apple Inc.',
  sector: 'Technology',
  asset_class: 'Stock',
  ...over,
});

export const summary = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  total_value: 12345.67,
  total_cost: 11111.11,
  unrealized_pnl: 1234.56,
  unrealized_pct: 11.11,
  realized_pnl: -50,
  holdings: [holding()],
  ...over,
});

export const watchItem = (over: Partial<WatchItem> = {}): WatchItem => ({
  id: 1,
  ticker: 'AAPL',
  name: 'Apple',
  upper_limit: 200,
  lower_limit: null,
  upper_state: 'armed',
  lower_state: 'armed',
  note: null,
  price: 180,
  price_as_of: todayISO(),
  price_kind: 'manual',
  pct_to_target: 11.11,
  ...over,
});
