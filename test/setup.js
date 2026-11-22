// Runs before every test file. Zustand's persisted stores use AsyncStorage, whose native module
// does not exist in Jest; this is the in-memory version the library ships for tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
