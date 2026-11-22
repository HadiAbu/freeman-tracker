import { render, screen } from '@testing-library/react-native';
import React from 'react';

import RootLayout from '@/app/_layout';

let mockReady = false;
jest.mock('@/stores', () => ({ useStoresReady: () => mockReady }));
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  function Stack() {
    return <Text>router-stack</Text>;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return { Stack };
});
jest.mock('@/components/splash-overlay', () => ({
  AnimatedSplashOverlay: () => {
    const { Text } = require('react-native');
    return <Text>splash</Text>;
  },
}));
// No real storage or network: the providers only need a client and a persister that restore nothing.
jest.mock('@/lib/query-client', () => {
  const { QueryClient } = require('@tanstack/react-query');
  return {
    PERSIST_BUSTER: 'test',
    PERSIST_MAX_AGE: 1000,
    queryClient: new QueryClient(),
    queryPersister: {
      persistClient: jest.fn(),
      restoreClient: jest.fn().mockResolvedValue(undefined),
      removeClient: jest.fn(),
    },
  };
});

test('no screen is drawn until saved settings are loaded, but the splash is already up', async () => {
  mockReady = false;
  await render(<RootLayout />);
  expect(screen.getByText('splash')).toBeTruthy();
  expect(screen.queryByText('router-stack')).toBeNull();
});

test('screens appear once the settings are loaded, and the splash stays', async () => {
  mockReady = false;
  const view = await render(<RootLayout />);
  expect(screen.queryByText('router-stack')).toBeNull();
  mockReady = true;
  await view.rerender(<RootLayout />);
  expect(screen.getByText('router-stack')).toBeTruthy();
  expect(screen.getByText('splash')).toBeTruthy();
});
