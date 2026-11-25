import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import { CaseList } from '@/components/analysis/case-list';
import { SourceList } from '@/components/analysis/source-list';
import { StanceChip } from '@/components/analysis/stance-chip';
import type { AnalysisSource } from '@/types';

const SOURCES: AnalysisSource[] = [
  {
    id: 'a1',
    title: 'Apple beats estimates',
    source: 'Reuters',
    published_at: '2026-11-17T09:00:00Z',
    url: 'https://example.com/a',
    origin: 'finnhub_company',
  },
  {
    id: 'b2',
    title: 'Plain http story',
    source: 'Wire',
    published_at: null,
    url: 'http://example.com/b',
    origin: 'gdelt',
  },
  {
    id: 'c3',
    title: '<b>Markup</b> headline',
    source: 'Wire',
    published_at: null,
    url: 'javascript:alert(1)',
    origin: 'gdelt',
  },
];

beforeEach(() => jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined));
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('StanceChip', () => {
  it('shows the lean and confidence as text and speaks it', async () => {
    await render(<StanceChip stance="hold" confidence="medium" />);
    expect(screen.getByText('Lean: hold')).toBeTruthy();
    expect(screen.getByText('medium confidence')).toBeTruthy();
    expect(screen.getByLabelText('Lean: hold, medium confidence')).toBeTruthy();
  });

  it('says there is no clear lean for unclear', async () => {
    await render(<StanceChip stance="unclear" confidence="low" />);
    expect(screen.getByText('No clear lean')).toBeTruthy();
  });
});

describe('CaseList', () => {
  it('renders each point with numbered citations', async () => {
    await render(
      <CaseList
        title="Case for"
        points={[{ point: 'Demand is strong', source_ids: ['a1', 'b2'] }]}
        sourceNumbers={{ a1: 1, b2: 2 }}
      />,
    );
    expect(screen.getByText('Case for')).toBeTruthy();
    expect(screen.getByText('Demand is strong')).toBeTruthy();
    expect(screen.getByText('[1] [2]')).toBeTruthy();
  });

  it('renders nothing when there are no points', async () => {
    await render(<CaseList title="Case against" points={[]} sourceNumbers={{}} />);
    expect(screen.queryByText('Case against')).toBeNull();
  });
});

describe('SourceList', () => {
  it('numbers sources and shows outlet and age', async () => {
    await render(<SourceList sources={SOURCES} now={new Date('2026-11-17T12:00:00Z')} />);
    expect(screen.getByText(/1\. Apple beats estimates/)).toBeTruthy();
    expect(screen.getByText('Reuters · 3 h ago')).toBeTruthy();
  });

  it('opens https links only; other links render as plain text', async () => {
    await render(<SourceList sources={SOURCES} />);
    await fireEvent.press(screen.getByRole('link', { name: /Apple beats estimates/ }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/a');
    expect(screen.queryByRole('link', { name: /Plain http story/ })).toBeNull();
    expect(screen.getByText(/2\. Plain http story/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Markup/ })).toBeNull();
  });

  it('shows markup in a headline literally, never as formatting', async () => {
    await render(<SourceList sources={SOURCES} />);
    expect(screen.getByText(/<b>Markup<\/b> headline/)).toBeTruthy();
  });
});
