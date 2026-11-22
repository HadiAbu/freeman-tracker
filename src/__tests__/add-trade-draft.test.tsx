import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AddTradeScreen from '@/app/add-trade';
import { api } from '@/lib/api';
import { todayISO } from '@/lib/format';
import { EMPTY_DRAFT, useTradeDraft } from '@/stores/trade-draft';
import { renderWithClient } from '@/test-utils/render';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { createTrade: jest.fn(), patchHolding: jest.fn() } };
});

const createTrade = api.createTrade as jest.Mock;
const patchHolding = api.patchHolding as jest.Mock;
const draft = () => useTradeDraft.getState().draft;
const flush = () => new Promise((r) => setImmediate(r));

const type = (label: string, value: string) => fireEvent.changeText(screen.getByLabelText(label), value);
const save = () => screen.getByRole('button', { name: 'Save trade' });

beforeEach(() => {
  jest.clearAllMocks();
  createTrade.mockResolvedValue({ id: 1 });
  patchHolding.mockResolvedValue({});
});

test('a blank form has no draft notice', async () => {
  await renderWithClient(<AddTradeScreen />);
  expect(screen.queryByText(/Restored your unsaved draft/)).toBeNull();
  expect(screen.getByLabelText('Date').props.value).toBe(todayISO());
});

test('everything typed is kept in the draft as it is typed', async () => {
  await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'nvda');
  await type('Shares', '2');
  await type('Price per share (USD)', '100');
  await type('Fee (optional)', '1');
  await type('Note (optional)', 'dip');
  await type('Sector (optional)', 'Technology');
  await type('Asset class (optional)', 'Stock');
  await fireEvent.press(screen.getByRole('button', { name: 'Sell' }));
  expect(draft()).toEqual({
    side: 'sell',
    ticker: 'nvda',
    shares: '2',
    price: '100',
    fee: '1',
    date: null,
    note: 'dip',
    sector: 'Technology',
    assetClass: 'Stock',
  });
});

test('the draft reaches device storage, so it survives the app being killed', async () => {
  await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'NVDA');
  await flush();
  const saved = JSON.parse((await AsyncStorage.getItem('freeman-trade-draft'))!);
  expect(saved.state.draft.ticker).toBe('NVDA');
});

test('reopening the form restores the draft and says so', async () => {
  useTradeDraft.setState({ draft: { ...EMPTY_DRAFT, side: 'sell', ticker: 'NVDA', shares: '4', price: '90' } });
  await renderWithClient(<AddTradeScreen />);
  expect(screen.getByLabelText('Ticker').props.value).toBe('NVDA');
  expect(screen.getByLabelText('Shares').props.value).toBe('4');
  expect(screen.getByLabelText('Price per share (USD)').props.value).toBe('90');
  expect(screen.getByRole('button', { name: 'Sell' })).toBeSelected();
  expect(screen.getByText('Restored your unsaved draft. Cancel discards it.')).toBeTruthy();
});

test('dismissing the modal without cancelling keeps the draft for next time', async () => {
  const first = await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'NVDA');
  await first.unmount();
  expect(draft().ticker).toBe('NVDA');
  await renderWithClient(<AddTradeScreen />);
  expect(screen.getByLabelText('Ticker').props.value).toBe('NVDA');
});

test('Cancel discards the draft and closes', async () => {
  useTradeDraft.setState({ draft: { ...EMPTY_DRAFT, ticker: 'NVDA' } });
  await renderWithClient(<AddTradeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(draft()).toEqual(EMPTY_DRAFT);
  expect(mockBack).toHaveBeenCalled();
  await flush();
  expect(JSON.parse((await AsyncStorage.getItem('freeman-trade-draft'))!).state.draft).toEqual(EMPTY_DRAFT);
});

test('a saved trade clears the draft', async () => {
  await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'nvda');
  await type('Shares', '2');
  await type('Price per share (USD)', '100');
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(createTrade).toHaveBeenCalledTimes(1);
  expect(draft()).toEqual(EMPTY_DRAFT);
});

test('a failed save keeps the draft so nothing typed is lost', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    createTrade.mockRejectedValue(new Error('Cannot sell more than you hold'));
    await renderWithClient(<AddTradeScreen />);
    await type('Ticker', 'nvda');
    await type('Shares', '2');
    await type('Price per share (USD)', '100');
    await fireEvent.press(save());
    expect(await screen.findByText('Cannot sell more than you hold')).toBeTruthy();
    expect(draft()).toMatchObject({ ticker: 'nvda', shares: '2', price: '100' });
    // and the retry works from the same values
    createTrade.mockResolvedValue({ id: 2 });
    await fireEvent.press(save());
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  } finally {
    spy.mockRestore();
  }
});

test('a validation error keeps the draft too', async () => {
  await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'nvda');
  await fireEvent.press(save());
  expect(screen.getByText('Shares must be greater than 0')).toBeTruthy();
  expect(draft().ticker).toBe('nvda');
  expect(createTrade).not.toHaveBeenCalled();
});

test('a trade saved after the screen was dismissed mid-request still clears the draft', async () => {
  let release: (v: unknown) => void = () => {};
  createTrade.mockReturnValue(new Promise((r) => (release = r)));
  const view = await renderWithClient(<AddTradeScreen />);
  await type('Ticker', 'nvda');
  await type('Shares', '2');
  await type('Price per share (USD)', '100');
  await fireEvent.press(save());
  await view.unmount();
  expect(draft().ticker).toBe('nvda'); // still saving: nothing cleared yet
  await act(async () => release({ id: 1 }));
  // otherwise reopening the form would offer the saved trade again, to be saved twice
  await waitFor(() => expect(draft()).toEqual(EMPTY_DRAFT));
});

describe('the date', () => {
  test('a date the user typed is kept', async () => {
    await renderWithClient(<AddTradeScreen />);
    await type('Date', '2026-10-01');
    expect(draft().date).toBe('2026-10-01');
  });

  test('today is not stored, so a draft left overnight does not record yesterday by mistake', async () => {
    await renderWithClient(<AddTradeScreen />);
    await type('Ticker', 'nvda');
    expect(draft().date).toBeNull();
    await type('Date', todayISO());
    expect(draft().date).toBeNull();
  });

  test('an untouched date follows the day the form is opened', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      jest.setSystemTime(new Date(2026, 0, 5, 12));
      useTradeDraft.setState({ draft: { ...EMPTY_DRAFT, ticker: 'NVDA' } });
      const first = await renderWithClient(<AddTradeScreen />);
      expect(screen.getByLabelText('Date').props.value).toBe('2026-01-05');
      await first.unmount();
      jest.setSystemTime(new Date(2026, 0, 6, 9)); // the next morning
      await renderWithClient(<AddTradeScreen />);
      expect(screen.getByLabelText('Date').props.value).toBe('2026-01-06');
    } finally {
      jest.useRealTimers();
    }
  });
});
