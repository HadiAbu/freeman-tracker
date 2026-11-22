import { AppState } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
const mockNetInfoListeners: ((s: { isConnected: boolean | null }) => void)[] = [];
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: (s: { isConnected: boolean | null }) => void) => {
      mockNetInfoListeners.push(cb);
      return () => mockNetInfoListeners.splice(mockNetInfoListeners.indexOf(cb), 1);
    },
  },
}));

// Load a fresh copy of the module (and of react-query, whose managers it configures).
function load() {
  let mod!: typeof import('@/lib/query-client');
  let rq!: typeof import('@tanstack/react-query');
  jest.isolateModules(() => {
    rq = require('@tanstack/react-query');
    mod = require('@/lib/query-client');
  });
  return { mod, rq };
}

beforeEach(() => {
  mockNetInfoListeners.length = 0;
});
afterEach(() => jest.restoreAllMocks());

test('cached queries are kept at least as long as the persisted copy is valid', () => {
  const { mod } = load();
  const defaults = mod.queryClient.getDefaultOptions().queries!;
  // if gcTime were shorter than maxAge, data would be collected before it could be restored
  expect(defaults.gcTime).toBeGreaterThanOrEqual(mod.PERSIST_MAX_AGE);
  expect(defaults.staleTime).toBe(30_000);
  expect(defaults.retry).toBe(1);
});

test('going offline pauses queries and coming back online resumes them', () => {
  const { rq } = load();
  const unsubscribe = rq.onlineManager.subscribe(() => {}); // starts the NetInfo listener
  expect(mockNetInfoListeners).toHaveLength(1);

  mockNetInfoListeners[0]({ isConnected: false });
  expect(rq.onlineManager.isOnline()).toBe(false);
  mockNetInfoListeners[0]({ isConnected: true });
  expect(rq.onlineManager.isOnline()).toBe(true);
  // an unknown state is treated as online rather than blocking every request
  mockNetInfoListeners[0]({ isConnected: null });
  expect(rq.onlineManager.isOnline()).toBe(true);
  unsubscribe();
});

test('foregrounding the app tells React Query it has focus again', () => {
  let onChange: (state: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    onChange = cb;
    return { remove: () => {} };
  }) as never);
  const { rq } = load();

  onChange('background');
  expect(rq.focusManager.isFocused()).toBe(false);
  onChange('active');
  expect(rq.focusManager.isFocused()).toBe(true);
});

test('the persisted cache is read back from device storage under the app key', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { mod } = load();
  const saved = { timestamp: Date.now(), buster: mod.PERSIST_BUSTER, clientState: { mutations: [], queries: [] } };
  await AsyncStorage.setItem('freeman-query-cache', JSON.stringify(saved));
  expect(await mod.queryPersister.restoreClient()).toEqual(saved);
});
