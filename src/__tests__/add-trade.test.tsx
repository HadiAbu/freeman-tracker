import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AddTradeScreen from '@/app/add-trade';
import { api } from '@/lib/api';

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

const clients: QueryClient[] = [];
function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AddTradeScreen />
    </QueryClientProvider>,
  );
}

async function fillTrade(extra: { sector?: string; assetClass?: string } = {}) {
  await fireEvent.changeText(screen.getByLabelText('Ticker'), 'nvda');
  await fireEvent.changeText(screen.getByLabelText('Shares'), '2');
  await fireEvent.changeText(screen.getByLabelText('Price per share (USD)'), '100');
  if (extra.sector)
    await fireEvent.changeText(screen.getByLabelText('Sector (optional)'), extra.sector);
  if (extra.assetClass)
    await fireEvent.changeText(screen.getByLabelText('Asset class (optional)'), extra.assetClass);
}

const save = () => screen.getByRole('button', { name: 'Save trade' });

beforeEach(() => {
  jest.clearAllMocks();
  createTrade.mockResolvedValue({ id: 1 });
  patchHolding.mockResolvedValue({});
});
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

test('blank classification saves the trade and makes no holdings request', async () => {
  await renderScreen();
  await fillTrade();
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(createTrade).toHaveBeenCalledTimes(1);
  expect(createTrade.mock.calls[0][0]).toMatchObject({
    ticker: 'NVDA',
    side: 'buy',
    shares: 2,
    price: 100,
  });
  expect(patchHolding).not.toHaveBeenCalled();
});

test('entered fields are PATCHed alone: no name, no nulls for the blank one', async () => {
  await renderScreen();
  await fillTrade({ assetClass: ' Stock ' });
  await fireEvent.press(save());
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(patchHolding).toHaveBeenCalledTimes(1);
  expect(patchHolding).toHaveBeenCalledWith('NVDA', { asset_class: 'Stock' });
});

test('a failed classification keeps the trade, shows a visible message and closes on Done', async () => {
  patchHolding.mockRejectedValue(new Error('boom'));
  await renderScreen();
  await fillTrade({ sector: 'Technology' });
  await fireEvent.press(save());
  expect(
    await screen.findByText(
      'Trade saved, but the classification could not be saved. Set it on the position screen.',
    ),
  ).toBeTruthy();
  expect(createTrade).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('a failed trade shows the error and posts no classification', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    createTrade.mockRejectedValue(new Error('Cannot sell more than you hold'));
    await renderScreen();
    await fillTrade({ sector: 'Technology' });
    await fireEvent.press(save());
    expect(await screen.findByText('Cannot sell more than you hold')).toBeTruthy();
    expect(patchHolding).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test('Save is ignored while the first save is still pending (no duplicate trade)', async () => {
  let release: (v: unknown) => void = () => {};
  createTrade.mockReturnValue(new Promise((r) => (release = r)));
  await renderScreen();
  await fillTrade({ sector: 'Technology' });
  await fireEvent.press(save());
  await fireEvent.press(screen.getByRole('button', { name: 'Save trade' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save trade' }));
  expect(createTrade).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Save trade' })).toBeDisabled();
  await act(async () => release({ id: 1 }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(createTrade).toHaveBeenCalledTimes(1);
  expect(patchHolding).toHaveBeenCalledTimes(1);
});

test('the classification is still saved when the screen unmounts mid-request', async () => {
  let release: (v: unknown) => void = () => {};
  createTrade.mockReturnValue(new Promise((r) => (release = r)));
  await renderScreen();
  await fillTrade({ sector: 'Technology' });
  await fireEvent.press(save());
  await screen.unmount();
  await act(async () => release({ id: 1 }));
  await waitFor(() => expect(patchHolding).toHaveBeenCalledWith('NVDA', { sector: 'Technology' }));
});

test.each([
  ['Shares', 'Infinity', 'Shares must be greater than 0'],
  ['Shares', '1e308', 'That number is too large'],
  ['Price per share (USD)', 'Infinity', 'Enter a price (0 or more)'],
  ['Price per share (USD)', '1e308', 'That number is too large'],
  ['Fee (optional)', 'Infinity', 'Fee must be 0 or more'],
  ['Fee (optional)', '1e308', 'That number is too large'],
])('rejects %p = %p without a request', async (label, bad, message) => {
  await renderScreen();
  await fillTrade();
  await fireEvent.changeText(screen.getByLabelText(label), bad);
  await fireEvent.press(save());
  expect(screen.getByText(message)).toBeTruthy();
  expect(createTrade).not.toHaveBeenCalled();
});
