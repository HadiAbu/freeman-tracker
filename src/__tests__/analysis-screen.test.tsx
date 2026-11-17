import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import AnalysisScreen, { DISCLAIMER } from '@/app/analysis/[ticker]';
import type { Analysis } from '@/types';

const mockMutate = jest.fn();
let mockLatest: { data?: Analysis | null; isPending: boolean; isError: boolean; error?: Error; refetch: jest.Mock };
let mockRun: { mutate: jest.Mock; isPending: boolean; isError: boolean; error: Error | null };
let mockSummary: { data?: { holdings: { ticker: string }[] } };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ticker: 'AAPL' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/hooks/use-analysis', () => ({
  useLatestAnalysis: () => mockLatest,
  useRunAnalysis: () => mockRun,
}));
jest.mock('@/hooks/use-trades', () => ({ usePortfolioSummary: () => mockSummary }));

const ANALYSIS: Analysis = {
  ticker: 'AAPL', generated_at: '2026-11-17T10:00:00Z', cached: false, personalized: true,
  stance: 'hold', confidence: 'medium', summary: 'A balanced picture.',
  case_for: [{ point: 'Demand is strong', source_ids: ['a1'] }],
  case_against: [{ point: 'Valuation is rich', source_ids: ['b2'] }],
  watch_for: ['Next earnings'],
  sources: [
    { id: 'a1', title: 'Apple beats estimates', source: 'Reuters', published_at: '2026-11-17T09:00:00Z', url: 'https://example.com/a', origin: 'finnhub_company' },
    { id: 'b2', title: 'Analysts warn on valuation', source: 'Wire', published_at: null, url: 'https://example.com/b', origin: 'gdelt' },
  ],
  notes: ['GDELT world news unavailable (rate limited).'], model: 'm',
};

beforeEach(() => {
  mockMutate.mockReset();
  mockLatest = { data: null, isPending: false, isError: false, refetch: jest.fn() };
  mockRun = { mutate: mockMutate, isPending: false, isError: false, error: null };
  mockSummary = { data: { holdings: [] } };
});

test('with no stored analysis it offers an explicit button and does not run by itself', async () => {
  await render(<AnalysisScreen />);
  expect(mockMutate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze with news' }));
  expect(mockMutate).toHaveBeenCalledWith({ personalize: false });
  expect(screen.getByText(DISCLAIMER)).toBeTruthy();
});

test('shows progress while an analysis is running', async () => {
  mockRun.isPending = true;
  await render(<AnalysisScreen />);
  expect(screen.getByText(/Reading the latest news/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Analyze with news' })).toBeNull();
});

test('renders the lean, both cases, sources, notes and the disclaimer', async () => {
  mockLatest.data = ANALYSIS;
  await render(<AnalysisScreen />);
  expect(screen.getByText('Lean: hold')).toBeTruthy();
  expect(screen.getByText('A balanced picture.')).toBeTruthy();
  expect(screen.getByText('Demand is strong')).toBeTruthy();
  expect(screen.getByText('Valuation is rich')).toBeTruthy();
  expect(screen.getByText('Next earnings')).toBeTruthy();
  expect(screen.getByText(/1\. Apple beats estimates/)).toBeTruthy();
  expect(screen.getByText(/GDELT world news unavailable/)).toBeTruthy();
  expect(screen.getByText(DISCLAIMER)).toBeTruthy();
});

test('Refresh asks for a refresh with the current position setting', async () => {
  mockLatest.data = ANALYSIS;
  mockSummary = { data: { holdings: [{ ticker: 'AAPL' }] } };
  await render(<AnalysisScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
  expect(mockMutate).toHaveBeenCalledWith({ refresh: true, personalize: true });
});

test('the position switch appears only for a held ticker and re-runs without the position when turned off', async () => {
  mockLatest.data = ANALYSIS;
  await render(<AnalysisScreen />);
  expect(screen.queryByLabelText('Use my position')).toBeNull(); // not held
  await screen.unmount();

  mockSummary = { data: { holdings: [{ ticker: 'AAPL' }] } };
  await render(<AnalysisScreen />);
  await fireEvent(screen.getByLabelText('Use my position'), 'valueChange', false);
  expect(mockMutate).toHaveBeenCalledWith({ personalize: false });
});

test('an unclear result explains itself instead of showing empty sections', async () => {
  mockLatest.data = { ...ANALYSIS, stance: 'unclear', confidence: 'low', case_for: [], case_against: [], watch_for: [], sources: [], summary: 'Not enough recent news to form a view.' };
  await render(<AnalysisScreen />);
  expect(screen.getByText('No clear lean')).toBeTruthy();
  expect(screen.getByText('Not enough recent news to form a view.')).toBeTruthy();
  expect(screen.queryByText('Case for')).toBeNull();
});

test('a failed run shows the server message in an error banner with Dismiss', async () => {
  mockRun.isError = true;
  mockRun.error = new Error('Refreshed recently. Try again in 10 minute(s).');
  await render(<AnalysisScreen />);
  expect(screen.getByText('Refreshed recently. Try again in 10 minute(s).')).toBeTruthy();
});

test('a failure to load the stored analysis shows an error with retry', async () => {
  mockLatest = { data: undefined, isPending: false, isError: true, error: new Error('Could not reach the server'), refetch: jest.fn() };
  await render(<AnalysisScreen />);
  expect(screen.getByText('Could not reach the server')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockLatest.refetch).toHaveBeenCalled();
});
