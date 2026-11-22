import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import AnalysisScreen from '@/app/analysis/[ticker]';
import { analysisKey } from '@/hooks/use-analysis';
import { api, ApiError } from '@/lib/api';
import type { Analysis } from '@/types';

// Real hooks and a real QueryClient; only the API layer is mocked.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ticker: 'AAPL' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    api: { analyze: jest.fn(), latestAnalysis: jest.fn(), portfolioSummary: jest.fn() },
  };
});

const analyze = api.analyze as jest.Mock;
const latestAnalysis = api.latestAnalysis as jest.Mock;
const portfolioSummary = api.portfolioSummary as jest.Mock;

const make = (over: Partial<Analysis>): Analysis => ({
  ticker: 'AAPL', generated_at: '2026-11-17T10:00:00Z', cached: false, personalized: true,
  stance: 'hold', confidence: 'medium', summary: 'Stored summary.',
  case_for: [], case_against: [], watch_for: [], sources: [], notes: [], model: 'm',
  ...over,
});

const clients: QueryClient[] = [];
let client: QueryClient;
async function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AnalysisScreen />
    </QueryClientProvider>,
  );
}

const held = () => portfolioSummary.mockResolvedValue({ holdings: [{ ticker: 'AAPL' }] });
const toggle = () => screen.getByLabelText('Use my position');

beforeEach(() => {
  jest.clearAllMocks();
  portfolioSummary.mockResolvedValue({ holdings: [] });
  latestAnalysis.mockRejectedValue(new ApiError(404, 'No analysis yet'));
});
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

test('toggling "Use my position" with no analysis shown does not start a run', async () => {
  held();
  await renderScreen();
  await screen.findByText('No analysis yet');
  await waitFor(() => expect(toggle()).toBeTruthy());
  await fireEvent(toggle(), 'valueChange', false);
  expect(analyze).not.toHaveBeenCalled();
  // ...but the setting is used by the next explicit Analyze tap
  analyze.mockResolvedValue(make({ personalized: false }));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze with news' }));
  await waitFor(() => expect(analyze).toHaveBeenCalledWith({ ticker: 'AAPL', personalize: false }));
});

test('the switch starts from the stored analysis personalized flag', async () => {
  held();
  latestAnalysis.mockResolvedValue(make({ personalized: false }));
  await renderScreen();
  await screen.findByText('Stored summary.');
  await waitFor(() => expect(toggle().props.value).toBe(false));
});

test('the switch defaults to on when the stored analysis used the position', async () => {
  held();
  latestAnalysis.mockResolvedValue(make({ personalized: true }));
  await renderScreen();
  await screen.findByText('Stored summary.');
  await waitFor(() => expect(toggle().props.value).toBe(true));
});

test('the switch is disabled while a run is pending and a second toggle posts nothing', async () => {
  held();
  latestAnalysis.mockResolvedValue(make({ personalized: true }));
  let release: (a: Analysis) => void = () => {};
  analyze.mockReturnValue(new Promise<Analysis>((r) => (release = r)));
  await renderScreen();
  await screen.findByText('Stored summary.');
  await waitFor(() => expect(toggle()).toBeTruthy());
  await fireEvent(toggle(), 'valueChange', false);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(analyze).toHaveBeenCalledWith({ ticker: 'AAPL', personalize: false });
  await fireEvent(toggle(), 'valueChange', true);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(toggle().props.disabled).toBe(true);
  await act(async () => release(make({ personalized: false, summary: 'Private summary.' })));
  expect(await screen.findByText('Private summary.')).toBeTruthy();
  expect(toggle().props.value).toBe(false);
});

test('a failed toggle reverts the switch and keeps the previous analysis', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    held();
    latestAnalysis.mockResolvedValue(make({ personalized: true }));
    analyze.mockRejectedValue(new ApiError(429, 'The daily limit for new analyses has been reached.'));
    await renderScreen();
    await screen.findByText('Stored summary.');
    await waitFor(() => expect(toggle()).toBeTruthy());
    await fireEvent(toggle(), 'valueChange', false);
    expect(await screen.findByText('The daily limit for new analyses has been reached.')).toBeTruthy();
    await waitFor(() => expect(toggle().props.value).toBe(true));
    expect(screen.getByText('Stored summary.')).toBeTruthy();
  } finally {
    spy.mockRestore();
  }
});

test('a refetch of the stored analysis does not replace a run result (thin-news result survives)', async () => {
  held();
  latestAnalysis.mockResolvedValueOnce(make({ summary: 'Old stored.' }));
  analyze.mockResolvedValue(
    make({ stance: 'unclear', confidence: 'low', summary: 'Not enough recent news to form a view.' }),
  );
  await renderScreen();
  await screen.findByText('Old stored.');
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Not enough recent news to form a view.')).toBeTruthy();

  // The server never stores thin-news results, so a refetch now returns 404 (or an older row).
  latestAnalysis.mockRejectedValue(new ApiError(404, 'No analysis yet'));
  await act(async () => {
    await client.refetchQueries({ queryKey: analysisKey('AAPL') });
  });
  expect(screen.getByText('Not enough recent news to form a view.')).toBeTruthy();
  expect(screen.queryByText('No analysis yet')).toBeNull();
});
