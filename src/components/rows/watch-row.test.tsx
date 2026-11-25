import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { WatchRow } from '@/components/rows/watch-row';
import { watchItem } from '@/test-utils/fixtures';

const show = (over = {}) =>
  render(<WatchRow item={watchItem(over)} onPress={jest.fn()} onLongPress={jest.fn()} />);

test('an armed upper limit shows how far the price has to go', async () => {
  await show({ price: 180, upper_limit: 200, pct_to_target: 11.11 });
  expect(screen.getByText('Alert above $200.00 · +11.11% to go')).toBeTruthy();
});

test('an armed lower limit shows how far the price could fall', async () => {
  await show({ price: 200, upper_limit: null, lower_limit: 150, pct_to_target: null });
  expect(screen.getByText('Alert below $150.00 · -25.00% to go')).toBeTruthy();
});

test('both limits get a line each', async () => {
  await show({ price: 180, upper_limit: 200, lower_limit: 150, pct_to_target: 11.11 });
  expect(screen.getByText(/Alert above \$200\.00/)).toBeTruthy();
  expect(screen.getByText(/Alert below \$150\.00/)).toBeTruthy();
});

test('a limit that was reached and emailed says it is paused', async () => {
  await show({ price: 210, upper_limit: 200, upper_state: 'triggered', pct_to_target: -4.76 });
  expect(
    screen.getByText('Alert above $200.00 · paused until the price crosses back'),
  ).toBeTruthy();
});

test('a limit that is reached but still armed (email not sent yet) says reached', async () => {
  await show({ price: 210, upper_limit: 200, upper_state: 'armed', pct_to_target: -4.76 });
  expect(screen.getByText('Alert above $200.00 · reached')).toBeTruthy();
});

test('without a price it asks for one', async () => {
  await show({ price: null, price_kind: null, price_as_of: null, pct_to_target: null });
  expect(screen.getByText('Alert above $200.00 · log a price to compare')).toBeTruthy();
});

test('an item with no limits says so', async () => {
  await show({ upper_limit: null, lower_limit: null, pct_to_target: null });
  expect(screen.getByText('No alerts set')).toBeTruthy();
});
