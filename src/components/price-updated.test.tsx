import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { PriceUpdated } from '@/components/price-updated';
import { usePriceStatus } from '@/stores/price-status';

const reset = { lastFetchedAt: null, failedCount: 0, unavailable: false };
beforeEach(() => usePriceStatus.setState(reset));

test('shows nothing before the first refresh', async () => {
  await render(<PriceUpdated />);
  expect(screen.queryByText(/Prices updated/)).toBeNull();
});

test('says when prices were updated, and how many could not be', async () => {
  usePriceStatus.setState({ lastFetchedAt: '2026-11-24T15:30:00Z', failedCount: 2 });
  await render(<PriceUpdated />);
  expect(screen.getByText(/Prices updated .*:\d\d/)).toBeTruthy();
  expect(screen.getByText(/2 could not be updated/)).toBeTruthy();
});

test('explains plainly when the server has no market data', async () => {
  usePriceStatus.setState({ unavailable: true });
  await render(<PriceUpdated />);
  expect(screen.getByText(/Showing the prices you entered/)).toBeTruthy();
});
