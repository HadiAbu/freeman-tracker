import type {
  AllocationBy,
  AllocationSlice,
  HistoryPoint,
  HoldingMeta,
  NewPrice,
  NewTrade,
  NewWatch,
  PortfolioSummary,
  PricePoint,
  Side,
  Trade,
  WatchItem,
} from '@/types';

// EXPO_PUBLIC_* values are inlined into the JS bundle at build time, so the key is
// readable by anyone who has the app. That is acceptable for a personal, single-user
// tracker; real accounts replace it later.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const API_KEY = process.env.EXPO_PUBLIC_API_KEY;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function detailToMessage(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI validation errors: [{ loc: [...], msg: '...' }]
    return detail.map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('\n');
  }
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BASE_URL || !API_KEY) {
    throw new ApiError(0, 'App is not configured: set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_API_KEY.');
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, ...init.headers },
    });
  } catch {
    throw new ApiError(0, `Could not reach the server at ${BASE_URL}.`);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = detailToMessage((await res.json()).detail) ?? message;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  // Newest first. A page shorter than `limit` is the last one.
  listTrades: (opts: { side?: Side; ticker?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.side) q.set('side', opts.side);
    if (opts.ticker) q.set('ticker', opts.ticker);
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    if (opts.offset !== undefined) q.set('offset', String(opts.offset));
    const qs = q.toString();
    return request<Trade[]>(`/trades${qs ? `?${qs}` : ''}`);
  },
  createTrade: (trade: NewTrade) =>
    request<Trade>('/trades', { method: 'POST', body: JSON.stringify(trade) }),
  deleteTrade: (id: number) => request<void>(`/trades/${id}`, { method: 'DELETE' }),
  portfolioSummary: () => request<PortfolioSummary>('/portfolio/summary'),
  allocation: (by: AllocationBy) => request<AllocationSlice[]>(`/portfolio/allocation?by=${by}`),
  history: () => request<HistoryPoint[]>('/portfolio/history'),
  priceHistory: (ticker: string) =>
    request<PricePoint[]>(`/prices/${encodeURIComponent(ticker)}`),
  listWatchlist: () => request<WatchItem[]>('/watchlist'),
  // POST upserts by ticker, so adding an existing ticker updates its target and note.
  addWatch: (item: NewWatch) =>
    request<WatchItem>('/watchlist', { method: 'POST', body: JSON.stringify(item) }),
  deleteWatch: (id: number) => request<void>(`/watchlist/${id}`, { method: 'DELETE' }),
  addPrice: (p: NewPrice) =>
    request<PricePoint>('/prices', { method: 'POST', body: JSON.stringify(p) }),
  putHolding: (ticker: string, meta: HoldingMeta) =>
    request<unknown>(`/holdings/${encodeURIComponent(ticker)}`, {
      method: 'PUT',
      body: JSON.stringify(meta),
    }),
};
