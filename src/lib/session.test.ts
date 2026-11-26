// session.ts keeps the tokens in module state, so every test loads a fresh copy.
type Session = typeof import('@/lib/session');
type AuthStore = typeof import('@/stores/auth');
// jest.resetModules() gives every test its own mock keychain, so load it with the session.
let SecureStore: typeof import('expo-secure-store');
let session: Session;
let auth: AuthStore;

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
const tokens = (n: number) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  expires_in: 900,
});
const stored = async () =>
  JSON.parse((await SecureStore.getItemAsync('freeman.session')) ?? 'null');

beforeEach(() => {
  jest.resetModules();
  SecureStore = require('expo-secure-store');
  session = require('@/lib/session');
  auth = require('@/stores/auth');
});
afterEach(() => jest.restoreAllMocks());

test('with nothing saved the app starts signed out', async () => {
  await session.restoreSession();
  expect(auth.useAuth.getState()).toMatchObject({ status: 'signedOut', email: null });
});

test('signing in stores the refresh token in the keychain and keeps the access token in memory only', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValue(reply(200, tokens(1)));
  await session.signIn('  Alice@Example.com ', 'a long password');

  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://api.test/auth/login');
  expect(JSON.parse(init.body as string)).toEqual({
    email: 'alice@example.com',
    password: 'a long password',
  });
  expect(auth.useAuth.getState()).toMatchObject({ status: 'signedIn', email: 'alice@example.com' });
  expect(await stored()).toEqual({ refreshToken: 'refresh-1', email: 'alice@example.com' });
  // the access token is never written to storage
  expect(JSON.stringify(await stored())).not.toContain('access-1');
  expect(await session.getAccessToken()).toBe('access-1');
});

test('a wrong password surfaces the server message and leaves the user signed out', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockReturnValue(reply(401, { detail: 'Incorrect email or password' }));
  await expect(session.signIn('a@b.co', 'nope')).rejects.toMatchObject({
    status: 401,
    message: 'Incorrect email or password',
  });
  expect(auth.useAuth.getState().status).not.toBe('signedIn');
  expect(await stored()).toBeNull();
});

test('a closed registration is reported, not swallowed', async () => {
  jest.spyOn(global, 'fetch').mockReturnValue(reply(403, { detail: 'Registration is closed' }));
  await expect(session.register('a@b.co', 'a long password')).rejects.toMatchObject({
    status: 403,
  });
});

test('a saved session opens signed in without touching the network (works offline)', async () => {
  await SecureStore.setItemAsync(
    'freeman.session',
    JSON.stringify({ refreshToken: 'refresh-1', email: 'a@b.co' }),
  );
  const fetchSpy = jest.spyOn(global, 'fetch');
  await session.restoreSession();
  expect(auth.useAuth.getState()).toMatchObject({ status: 'signedIn', email: 'a@b.co' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('the access token is fetched on first use and the rotated refresh token is saved', async () => {
  await SecureStore.setItemAsync(
    'freeman.session',
    JSON.stringify({ refreshToken: 'refresh-1', email: 'a@b.co' }),
  );
  await session.restoreSession();
  const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValue(reply(200, tokens(2)));
  expect(await session.getAccessToken()).toBe('access-2');
  expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({
    refresh_token: 'refresh-1',
  });
  expect(await stored()).toEqual({ refreshToken: 'refresh-2', email: 'a@b.co' });
});

test('parallel callers share one refresh (a second one would look like a token replay)', async () => {
  await SecureStore.setItemAsync(
    'freeman.session',
    JSON.stringify({ refreshToken: 'refresh-1', email: 'a@b.co' }),
  );
  await session.restoreSession();
  const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValue(reply(200, tokens(2)));
  await Promise.all([session.refreshSession(), session.refreshSession(), session.getAccessToken()]);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a refresh the server rejects ends the session and clears the keychain', async () => {
  await SecureStore.setItemAsync(
    'freeman.session',
    JSON.stringify({ refreshToken: 'refresh-1', email: 'a@b.co' }),
  );
  await session.restoreSession();
  jest
    .spyOn(global, 'fetch')
    .mockReturnValue(reply(401, { detail: 'Session expired. Sign in again.' }));
  expect(await session.refreshSession()).toBe(false);
  expect(auth.useAuth.getState().status).toBe('signedOut');
  expect(await stored()).toBeNull();
});

test('being offline during a refresh is an error, not a sign-out', async () => {
  await SecureStore.setItemAsync(
    'freeman.session',
    JSON.stringify({ refreshToken: 'refresh-1', email: 'a@b.co' }),
  );
  await session.restoreSession();
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  await expect(session.refreshSession()).rejects.toMatchObject({ status: 0 });
  expect(auth.useAuth.getState().status).toBe('signedIn');
  expect(await stored()).not.toBeNull();
});

test('signing out revokes the token, empties the keychain, runs cleanups and drops the draft', async () => {
  jest.spyOn(global, 'fetch').mockReturnValueOnce(reply(200, tokens(1)));
  await session.signIn('a@b.co', 'a long password');
  const { useTradeDraft } = require('@/stores/trade-draft');
  useTradeDraft.setState({ draft: { ...useTradeDraft.getState().draft, ticker: 'AAPL' } });
  const cleanup = jest.fn();
  session.onSessionEnd(cleanup);

  const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValue(reply(204));
  await session.endSession();

  // spyOn on an already-spied method returns the same spy, so the login call is still in the list
  const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
  expect(url).toBe('http://api.test/auth/logout');
  expect(JSON.parse(init.body as string)).toEqual({ refresh_token: 'refresh-1' });
  expect(auth.useAuth.getState()).toMatchObject({ status: 'signedOut', email: null });
  expect(await stored()).toBeNull();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(useTradeDraft.getState().draft.ticker).toBe('');
  expect(await session.getAccessToken()).toBeNull();
});

test('signing out while offline still forgets everything on this device', async () => {
  jest.spyOn(global, 'fetch').mockReturnValueOnce(reply(200, tokens(1)));
  await session.signIn('a@b.co', 'a long password');
  jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  await session.endSession();
  expect(auth.useAuth.getState().status).toBe('signedOut');
  expect(await stored()).toBeNull();
});

test('one failing cleanup does not stop the others', async () => {
  await session.restoreSession();
  const after = jest.fn();
  session.onSessionEnd(() => {
    throw new Error('boom');
  });
  session.onSessionEnd(after);
  await session.endSession({ remote: false });
  expect(after).toHaveBeenCalled();
});
