import { areStoresSettled } from '@/stores/persist';

// Each case loads a fresh copy of the stores (and of their storage) so hydration happens again.
function loadStores(prepare: (storage: { getItem: jest.Mock }) => void) {
  let persist!: typeof import('@/stores/persist');
  jest.isolateModules(() => {
    prepare(require('@react-native-async-storage/async-storage'));
    persist = require('@/stores/persist');
    require('@/stores');
  });
  return persist;
}
const flush = () => new Promise((r) => setImmediate(r));

test('the shared test copy of the stores has finished loading', async () => {
  await flush();
  expect(areStoresSettled()).toBe(true);
});

test('the gate is closed while storage is still loading, then opens', async () => {
  let release: (v: null) => void = () => {};
  const persist = loadStores((s) => s.getItem.mockReturnValue(new Promise((r) => (release = r))));
  await flush();
  expect(persist.areStoresSettled()).toBe(false);
  release(null);
  await flush();
  expect(persist.areStoresSettled()).toBe(true);
});

test('the gate still opens when storage throws, so the app never stays blank', async () => {
  const persist = loadStores((s) => s.getItem.mockRejectedValue(new Error('disk error')));
  await flush();
  expect(persist.areStoresSettled()).toBe(true);
});
