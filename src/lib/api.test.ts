import { api, ApiError } from '@/lib/api';

// jest.config.js sets EXPO_PUBLIC_API_URL=http://api.test and EXPO_PUBLIC_API_KEY=test-key.

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

afterEach(() => jest.restoreAllMocks());

test('analyze posts the request and returns the analysis', async () => {
  const spy = jest.spyOn(global, 'fetch').mockReturnValue(json(200, { ticker: 'AAPL', stance: 'hold' }));
  const result = await api.analyze({ ticker: 'AAPL', personalize: false });
  expect(result).toEqual({ ticker: 'AAPL', stance: 'hold' });
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toBe('http://api.test/analysis');
  expect((init as RequestInit).method).toBe('POST');
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ ticker: 'AAPL', personalize: false });
  expect(((init as RequestInit).headers as Record<string, string>)['X-API-Key']).toBe('test-key');
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
  const assertion = expect(pending).rejects.toMatchObject({ message: expect.stringContaining('took too long') });
  await jest.advanceTimersByTimeAsync(91_000);
  await assertion;
  jest.useRealTimers();
});

test('ApiError carries its status', () => {
  expect(new ApiError(502, 'x').status).toBe(502);
});
