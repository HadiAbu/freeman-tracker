// Runs after the test framework is installed, before every test file's own hooks.
// Persisted stores are module singletons: put them back to their defaults before each test so
// one test's "hide balances" or half-typed draft can never leak into the next. This is a
// beforeEach, not an afterEach: by then the previous test's screens are already unmounted, so
// resetting cannot trigger updates on mounted components (React's "not wrapped in act" warning).
const AsyncStorage = require('@react-native-async-storage/async-storage');
const { usePreferences, DEFAULT_PREFERENCES } = require('@/stores/preferences');
const { useTradeDraft, EMPTY_DRAFT } = require('@/stores/trade-draft');

beforeEach(async () => {
  usePreferences.setState({ ...DEFAULT_PREFERENCES });
  useTradeDraft.setState({ draft: EMPTY_DRAFT });
  await AsyncStorage.clear();
});
