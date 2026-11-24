// Runs before every test file. Zustand's persisted stores use AsyncStorage, whose native module
// does not exist in Jest; this is the in-memory version the library ships for tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Crash reporting is inert in tests (no DSN) and the real SDK is ESM plus native code, so stub it.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
