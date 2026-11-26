import { render, screen } from '@testing-library/react-native';
import React from 'react';

import AppTabs, { COMPACT_TAB_BAR_WIDTH } from '@/components/layout/app-tabs.web';

jest.mock('expo-router/ui', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Tabs: Pass, TabList: Pass, TabTrigger: Pass, TabSlot: () => null };
});
let mockWidth = 800;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 1, fontScale: 1 }),
}));

function atWidth(width: number) {
  mockWidth = width;
}

const tabs = ['Dashboard', 'Portfolio', 'Watchlist', 'Trades'];

test('a wide window shows the brand name beside the four tabs', async () => {
  atWidth(COMPACT_TAB_BAR_WIDTH);
  await render(<AppTabs />);
  expect(screen.getByText('Freeman')).toBeTruthy();
  tabs.forEach((t) => expect(screen.getByText(t)).toBeTruthy());
});

test('a narrow window drops the brand name and keeps all four tabs', async () => {
  atWidth(COMPACT_TAB_BAR_WIDTH - 1);
  await render(<AppTabs />);
  expect(screen.queryByText('Freeman')).toBeNull();
  tabs.forEach((t) => expect(screen.getByText(t)).toBeTruthy());
});
