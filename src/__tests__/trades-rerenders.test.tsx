import { fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import TradesScreen from '@/app/(tabs)/trades';
import { api } from '@/lib/api';
import { trade } from '@/test-utils/fixtures';
import { renderWithClient } from '@/test-utils/render';

// useMoney runs once per TradeRow render, so counting its calls counts row renders.
const mockRowRenders = jest.fn();
jest.mock('@/hooks/use-money', () => {
  const actual = jest.requireActual('@/hooks/use-money');
  return {
    useMoney: () => {
      mockRowRenders();
      return actual.useMoney();
    },
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/confirm', () => ({
  confirmDestructive: (_t: string, _m: string, _l: string, onConfirm: () => void) => onConfirm(),
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { listTrades: jest.fn(), deleteTrade: jest.fn() } };
});

test('a parent state change that does not touch the data leaves the rows alone', async () => {
  (api.listTrades as jest.Mock).mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => trade({ id: i + 1, ticker: `T${i + 1}` })),
  );
  (api.deleteTrade as jest.Mock).mockRejectedValue(new Error('Cannot delete'));

  await renderWithClient(<TradesScreen />);
  await fireEvent(await screen.findByText('T1'), 'longPress'); // fails, so the screen shows an error banner
  expect(await screen.findByText('Cannot delete')).toBeTruthy();

  // Rows that are not the one pressed were not given new props, so they must not draw again.
  // Settle first, then measure what one more unrelated parent render costs.
  const settled = mockRowRenders.mock.calls.length;
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' })); // clears the banner: parent re-renders
  const extra = mockRowRenders.mock.calls.length - settled;
  // eslint-disable-next-line no-console
  console.log(`row renders: ${settled} before dismiss, +${extra} caused by the parent re-render (5 rows)`);
  expect(extra).toBe(0);
});
