import type { NewTrade, PortfolioSummary, Side, Trade } from '@/types';

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
  listTrades: (opts: { side?: Side; ticker?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.side) q.set('side', opts.side);
    if (opts.ticker) q.set('ticker', opts.ticker);
    const qs = q.toString();
    return request<Trade[]>(`/trades${qs ? `?${qs}` : ''}`);
  },
  createTrade: (trade: NewTrade) =>
    request<Trade>('/trades', { method: 'POST', body: JSON.stringify(trade) }),
  deleteTrade: (id: number) => request<void>(`/trades/${id}`, { method: 'DELETE' }),
  portfolioSummary: () => request<PortfolioSummary>('/portfolio/summary'),
};
