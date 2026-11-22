import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMPTY_DRAFT, isEmptyDraft, sanitizeDraft, useTradeDraft } from '@/stores/trade-draft';

const KEY = 'freeman-trade-draft';
const flush = () => new Promise((r) => setImmediate(r));

test('starts empty', () => {
  expect(useTradeDraft.getState().draft).toEqual(EMPTY_DRAFT);
  expect(isEmptyDraft(useTradeDraft.getState().draft)).toBe(true);
});

test('setDraft merges into the draft without losing other fields', () => {
  const { setDraft } = useTradeDraft.getState();
  setDraft({ ticker: 'NVDA' });
  setDraft({ shares: '3', side: 'sell' });
  expect(useTradeDraft.getState().draft).toEqual({ ...EMPTY_DRAFT, ticker: 'NVDA', shares: '3', side: 'sell' });
  expect(isEmptyDraft(useTradeDraft.getState().draft)).toBe(false);
});

test('clear empties the draft', () => {
  useTradeDraft.getState().setDraft({ ticker: 'NVDA', note: 'x' });
  useTradeDraft.getState().clear();
  expect(useTradeDraft.getState().draft).toEqual(EMPTY_DRAFT);
});

test.each([
  [{ side: 'sell' as const }],
  [{ ticker: 'A' }],
  [{ shares: '1' }],
  [{ price: '1' }],
  [{ fee: '1' }],
  [{ date: '2026-01-01' }],
  [{ note: 'n' }],
  [{ sector: 's' }],
  [{ assetClass: 'a' }],
])('any single entered field (%p) makes the draft worth restoring', (patch) => {
  expect(isEmptyDraft({ ...EMPTY_DRAFT, ...patch })).toBe(false);
});

test('the draft is written to device storage and restored on the next launch', async () => {
  useTradeDraft.getState().setDraft({ ticker: 'NVDA', shares: '2', date: '2026-10-01' });
  await flush();
  const raw = (await AsyncStorage.getItem(KEY))!;
  expect(JSON.parse(raw).state.draft).toMatchObject({ ticker: 'NVDA', shares: '2', date: '2026-10-01' });

  // A restart: memory starts empty but the device storage still holds what was saved. (setState
  // on a persisted store writes through, so put the saved copy back before loading it.)
  useTradeDraft.setState({ draft: EMPTY_DRAFT });
  await AsyncStorage.setItem(KEY, raw);
  await useTradeDraft.persist.rehydrate();
  expect(useTradeDraft.getState().draft).toMatchObject({ ticker: 'NVDA', shares: '2', date: '2026-10-01' });
  expect(typeof useTradeDraft.getState().setDraft).toBe('function');
});

test('corrupt storage leaves an empty draft', async () => {
  await AsyncStorage.setItem(KEY, '{not json');
  await expect(useTradeDraft.persist.rehydrate()).resolves.toBeUndefined();
  expect(useTradeDraft.getState().draft).toEqual(EMPTY_DRAFT);
});

describe('sanitizeDraft', () => {
  test.each([null, undefined, 'x', 7])('a non-object (%p) gives an empty draft', (raw) => {
    expect(sanitizeDraft(raw)).toEqual(EMPTY_DRAFT);
  });

  test('keeps well-typed fields and drops the rest', () => {
    expect(sanitizeDraft({ ticker: 'NVDA', shares: 5, side: 'hold', date: 20260101, note: 'ok' })).toEqual({
      ...EMPTY_DRAFT,
      ticker: 'NVDA',
      note: 'ok',
    });
  });
});
