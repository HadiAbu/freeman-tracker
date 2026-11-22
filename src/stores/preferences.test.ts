import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PREFERENCES, sanitizePreferences, usePreferences } from '@/stores/preferences';

const KEY = 'freeman-preferences';
const stored = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null');
const flush = () => new Promise((r) => setImmediate(r));

test('starts with the defaults', () => {
  expect(usePreferences.getState()).toMatchObject(DEFAULT_PREFERENCES);
  expect(DEFAULT_PREFERENCES).toEqual({
    hideBalances: false,
    allocationBy: 'ticker',
    tradesSide: null,
    personalizeDefault: true,
  });
});

test('each setter changes only its own setting', () => {
  const { toggleHideBalances, setAllocationBy, setTradesSide, setPersonalizeDefault } = usePreferences.getState();
  toggleHideBalances();
  expect(usePreferences.getState().hideBalances).toBe(true);
  toggleHideBalances();
  expect(usePreferences.getState().hideBalances).toBe(false);

  setAllocationBy('sector');
  setTradesSide('sell');
  setPersonalizeDefault(false);
  expect(usePreferences.getState()).toMatchObject({
    hideBalances: false,
    allocationBy: 'sector',
    tradesSide: 'sell',
    personalizeDefault: false,
  });
});

test('changes are written to device storage as plain data (no functions)', async () => {
  usePreferences.getState().toggleHideBalances();
  usePreferences.getState().setAllocationBy('asset_class');
  await flush();
  expect(await stored()).toEqual({
    state: { hideBalances: true, allocationBy: 'asset_class', tradesSide: null, personalizeDefault: true },
    version: 1,
  });
});

test('saved settings are restored on the next launch', async () => {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      state: { hideBalances: true, allocationBy: 'sector', tradesSide: 'buy', personalizeDefault: false },
      version: 1,
    }),
  );
  await usePreferences.persist.rehydrate();
  expect(usePreferences.getState()).toMatchObject({
    hideBalances: true,
    allocationBy: 'sector',
    tradesSide: 'buy',
    personalizeDefault: false,
  });
  // the actions survive a restore
  expect(typeof usePreferences.getState().toggleHideBalances).toBe('function');
});

test('a setting missing from an older save keeps its default', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ state: { hideBalances: true }, version: 1 }));
  await usePreferences.persist.rehydrate();
  expect(usePreferences.getState()).toMatchObject({ ...DEFAULT_PREFERENCES, hideBalances: true });
});

test('corrupt storage leaves the defaults instead of failing', async () => {
  await AsyncStorage.setItem(KEY, '{not json');
  await expect(usePreferences.persist.rehydrate()).resolves.toBeUndefined();
  expect(usePreferences.getState()).toMatchObject(DEFAULT_PREFERENCES);
});

describe('sanitizePreferences', () => {
  test.each([null, undefined, 'x', 5])('ignores a non-object (%p)', (raw) => {
    expect(sanitizePreferences(raw)).toEqual({});
  });

  test('drops wrongly typed or unknown values and keeps good ones', () => {
    expect(
      sanitizePreferences({
        hideBalances: 'yes',
        allocationBy: 'region',
        tradesSide: 'hold',
        personalizeDefault: false,
        extra: 1,
      }),
    ).toEqual({ personalizeDefault: false });
  });

  test('accepts every valid value', () => {
    expect(sanitizePreferences({ allocationBy: 'asset_class', tradesSide: null, hideBalances: false })).toEqual({
      allocationBy: 'asset_class',
      tradesSide: null,
      hideBalances: false,
    });
    expect(sanitizePreferences({ tradesSide: 'sell' })).toEqual({ tradesSide: 'sell' });
  });
});
