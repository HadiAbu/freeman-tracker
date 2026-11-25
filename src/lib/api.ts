import type {
  AllocationBy,
  Analysis,
  AnalysisRequest,
  AllocationSlice,
  HistoryPoint,
  HoldingMeta,
  NewPrice,
  NewTrade,
  NewWatch,
  PortfolioSummary,
  PriceRefreshResult,
  PricePoint,
  Side,
  Trade,
  WatchItem,
} from '@/types';
import { AuthError, getAccessToken, refreshSession } from '@/lib/session';

// The API address is public. Access is by a per-user token (see lib/session), never a secret
// compiled into the bundle.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

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

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

/** Turns a failure from the token layer into the error shape screens already handle. */
async function currentToken(): Promise<string> {
  let token: string | null;
  try {
    token = await getAccessToken();
  } catch (e) {
    if (e instanceof AuthError) throw new ApiError(e.status, e.message);
    throw e;
  }
  if (!token) throw new ApiError(401, SESSION_ENDED);
  return token;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
  retried = false,
): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(0, 'App is not configured: set EXPO_PUBLIC_API_URL.');
  }
  const token = await currentToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';
  const tooLong = () => new ApiError(0, 'The request took too long. Please try again.');

  // The timer stays armed until the body has been read, so a server that sends headers and
  // then stalls cannot hang the caller forever.
  try {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    } catch (e) {
      if (isAbort(e)) throw tooLong();
      throw new ApiError(0, `Could not reach the server at ${BASE_URL}.`);
    }

    if (res.status === 401 && !retried) {
      // The access token expired (they last 15 minutes). Swap the refresh token for a new pair and
      // try once more; if the server rejects the refresh the session is over.
      let renewed = false;
      try {
        renewed = await refreshSession();
      } catch (e) {
        if (e instanceof AuthError) throw new ApiError(e.status, e.message);
        throw e;
      }
      if (!renewed) throw new ApiError(401, SESSION_ENDED);
      return request<T>(path, init, timeoutMs, true);
    }

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        message = detailToMessage((await res.json()).detail) ?? message;
      } catch (e) {
        if (isAbort(e)) throw tooLong();
        // non-JSON error body; keep the generic message
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch (e) {
      if (isAbort(e)) throw tooLong();
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
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
  // The server stops asking the provider after 20 s, so allow a little longer than that.
  refreshPrices: () =>
    request<PriceRefreshResult>('/prices/refresh', { method: 'POST' }, 30_000),
  addPrice: (p: NewPrice) =>
    request<PricePoint>('/prices', { method: 'POST', body: JSON.stringify(p) }),
  // A news analysis can take a while (news fetch + model call), so allow 90 seconds.
  analyze: (req: AnalysisRequest) =>
    request<Analysis>('/analysis', { method: 'POST', body: JSON.stringify(req) }, 90_000),
  latestAnalysis: (ticker: string) => request<Analysis>(`/analysis/${encodeURIComponent(ticker)}`),
  putHolding: (ticker: string, meta: HoldingMeta) =>
    request<unknown>(`/holdings/${encodeURIComponent(ticker)}`, {
      method: 'PUT',
      body: JSON.stringify(meta),
    }),
  // Partial update: only the fields present in `meta` change on the server.
  patchHolding: (ticker: string, meta: HoldingMeta) =>
    request<unknown>(`/holdings/${encodeURIComponent(ticker)}`, {
      method: 'PATCH',
      body: JSON.stringify(meta),
    }),
};
