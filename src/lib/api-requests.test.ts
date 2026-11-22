import { api, ApiError } from '@/lib/api';

// jest.config.js sets EXPO_PUBLIC_API_URL=http://api.test and EXPO_PUBLIC_API_KEY=test-key.

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

const lastCall = (spy: jest.SpyInstance) => {
  const [url, init] = spy.mock.calls.at(-1) as [string, RequestInit];
  return { url: String(url), init };
};

afterEach(() => jest.restoreAllMocks());

describe('listTrades', () => {
  test('builds the query string from the options given', async () => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, []));
    await api.listTrades({ side: 'sell', ticker: 'NVDA', limit: 100, offset: 200 });
    expect(lastCall(spy).url).toBe('http://api.test/trades?side=sell&ticker=NVDA&limit=100&offset=200');
  });

  test('sends no query string when there are no options, and keeps offset 0', async () => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, []));
    await api.listTrades();
    expect(lastCall(spy).url).toBe('http://api.test/trades');
    await api.listTrades({ offset: 0 });
    expect(lastCall(spy).url).toBe('http://api.test/trades?offset=0');
  });
});

describe('requests', () => {
  test.each([
    ['createTrade', () => api.createTrade({ ticker: 'A', side: 'buy', shares: 1, price: 1, fee: 0, traded_at: '2026-11-01' }), 'POST', '/trades'],
    ['addWatch', () => api.addWatch({ ticker: 'A' }), 'POST', '/watchlist'],
    ['addPrice', () => api.addPrice({ ticker: 'A', price: 1, as_of: '2026-11-01' }), 'POST', '/prices'],
    ['putHolding', () => api.putHolding('A', { sector: 'Tech' }), 'PUT', '/holdings/A'],
    ['patchHolding', () => api.patchHolding('A', { sector: 'Tech' }), 'PATCH', '/holdings/A'],
  ])('%s uses %s %s with the API key', async (_name, call, method, path) => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, {}));
    await call();
    const { url, init } = lastCall(spy);
    expect(url).toBe(`http://api.test${path}`);
    expect(init.method).toBe(method);
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
  });

  test('tickers are URL-encoded in paths', async () => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, []));
    await api.priceHistory('BRK/B');
    expect(lastCall(spy).url).toBe('http://api.test/prices/BRK%2FB');
    await api.patchHolding('A B', {});
    expect(lastCall(spy).url).toBe('http://api.test/holdings/A%20B');
  });

  test('allocation passes the dimension', async () => {
    const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, []));
    await api.allocation('asset_class');
    expect(lastCall(spy).url).toBe('http://api.test/portfolio/allocation?by=asset_class');
  });

  test('a 204 resolves to undefined without reading a body', async () => {
    const body = jest.fn();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204, json: body } as unknown as Response);
    await expect(api.deleteTrade(1)).resolves.toBeUndefined();
    expect(body).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  test('FastAPI validation errors become one line per field', async () => {
    jest.spyOn(global, 'fetch').mockReturnValue(
      json(422, {
        detail: [
          { loc: ['body', 'ticker'], msg: 'Field required' },
          { loc: ['body', 'price'], msg: 'Input should be greater than 0' },
        ],
      }),
    );
    await expect(api.addPrice({ ticker: '', price: 0, as_of: 'x' })).rejects.toMatchObject({
      status: 422,
      message: 'ticker: Field required\nprice: Input should be greater than 0',
    });
  });

  test('a plain-string detail is used as the message', async () => {
    jest.spyOn(global, 'fetch').mockReturnValue(json(409, { detail: 'Cannot delete: a later sell depends on this buy' }));
    await expect(api.deleteTrade(1)).rejects.toMatchObject({
      status: 409,
      message: 'Cannot delete: a later sell depends on this buy',
    });
  });

  test('a non-JSON error body falls back to the status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response);
    await expect(api.listWatchlist()).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  test('an unreachable server says which server', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const err = await api.listWatchlist().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: 'Could not reach the server at http://api.test.' });
  });

  test('a missing configuration fails clearly and never calls fetch', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const saved = { url: process.env.EXPO_PUBLIC_API_URL, key: process.env.EXPO_PUBLIC_API_KEY };
    process.env.EXPO_PUBLIC_API_URL = '';
    process.env.EXPO_PUBLIC_API_KEY = '';
    try {
      let unconfigured: typeof api | undefined;
      jest.isolateModules(() => {
        unconfigured = require('@/lib/api').api;
      });
      await expect(unconfigured!.listWatchlist()).rejects.toMatchObject({
        status: 0,
        message: expect.stringContaining('EXPO_PUBLIC_API_URL'),
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.EXPO_PUBLIC_API_URL = saved.url;
      process.env.EXPO_PUBLIC_API_KEY = saved.key;
    }
  });

  test('a trailing slash on the base URL is ignored', async () => {
    const saved = process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_API_URL = 'http://api.test/';
    try {
      const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, []));
      let slashed: typeof api | undefined;
      jest.isolateModules(() => {
        slashed = require('@/lib/api').api;
      });
      await slashed!.listWatchlist();
      expect(lastCall(spy).url).toBe('http://api.test/watchlist');
    } finally {
      process.env.EXPO_PUBLIC_API_URL = saved;
    }
  });
});
