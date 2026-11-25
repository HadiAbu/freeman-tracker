// Runs before every test file. Zustand's persisted stores use AsyncStorage, whose native module
// does not exist in Jest; this is the in-memory version the library ships for tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The keychain does not exist in Jest. An in-memory stand-in with the same async API; tests that
// need a clean slate call `__reset` (see src/test-utils/session.ts).
jest.mock('expo-secure-store', () => {
  let store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
    __reset: () => {
      store = new Map();
    },
  };
});
