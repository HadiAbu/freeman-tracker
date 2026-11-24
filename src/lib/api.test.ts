import { api, ApiError } from '@/lib/api';

// jest.config.js sets EXPO_PUBLIC_API_URL=http://api.test.

// The token layer is tested on its own (session.test.ts). Here it hands out a fixed token.
const mockSession = { getAccessToken: jest.fn(), refreshSession: jest.fn() };
jest.mock('@/lib/session', () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    AuthError,
    getAccessToken: (...a: unknown[]) => mockSession.getAccessToken(...a),
    refreshSession: (...a: unknown[]) => mockSession.refreshSession(...a),
  };
});
beforeEach(() => {
  mockSession.getAccessToken.mockReset();
  mockSession.refreshSession.mockReset();
  mockSession.getAccessToken.mockResolvedValue('test-token');
  mockSession.refreshSession.mockResolvedValue(true);
});


const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('analyze posts the request and returns the analysis', async () => {
  const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, { ticker: 'AAPL', stance: 'hold' }));
  const result = await api.analyze({ ticker: 'AAPL', personalize: false });
  expect(result).toEqual({ ticker: 'AAPL', stance: 'hold' });
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toBe('http://api.test/analysis');
  expect((init as RequestInit).method).toBe('POST');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ ticker: 'AAPL', personalize: false });
  expect(((init as RequestInit).headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
});

test('latestAnalysis encodes the ticker', async () => {
  const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, {}));
  await api.latestAnalysis('BRK.B');
  expect(String(spy.mock.calls[0][0])).toBe('http://api.test/analysis/BRK.B');
});

test('server error details become readable ApiError messages (429 keeps its status)', async () => {
  jest.spyOn(global, 'fetch').mockReturnValue(json(429, { detail: 'Refreshed recently. Try again in 10 minute(s).' }));
  await expect(api.analyze({ ticker: 'AAPL' })).rejects.toMatchObject({
    status: 429,
    message: 'Refreshed recently. Try again in 10 minute(s).',
  });
});

test('a request that never finishes is aborted with a clear message', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const pending = api.analyze({ ticker: 'AAPL' });
  let settled = false;
  const assertion = expect(pending).rejects.toMatchObject({ message: expect.stringContaining('took too long') });
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  await jest.advanceTimersByTimeAsync(16_000);
  expect(settled).toBe(false); // analyze must outlive the 15 s default
  await jest.advanceTimersByTimeAsync(75_000);
  await assertion;
  expect(settled).toBe(true);
});

test('the timeout also covers reading the response body', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockImplementation(
    (_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            (init as RequestInit).signal!.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      } as unknown as Response),
  );
  const assertion = expect(api.listTrades()).rejects.toMatchObject({
    message: expect.stringContaining('took too long'),
  });
  await jest.advanceTimersByTimeAsync(16_000);
  await assertion;
});

test('ApiError carries its status', () => {
  expect(new ApiError(502, 'x').status).toBe(502);
});
