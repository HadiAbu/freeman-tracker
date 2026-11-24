import { render, screen } from '@testing-library/react-native';
import React from 'react';

import * as SecureStore from 'expo-secure-store';

import RootLayout from '@/app/_layout';
import { useAuth } from '@/stores/auth';

let mockReady = false;
jest.mock('@/stores', () => ({ useStoresReady: () => mockReady }));
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  function Stack({ children }: { children?: React.ReactNode }) {
    return (
      <>
        <Text>router-stack</Text>
        {children}
      </>
    );
  }
  Stack.Screen = function Screen() {
    return null;
  };
  // Records the guard so a test can check which side of the route guard is open.
  Stack.Protected = function Protected({ guard, children }: { guard: boolean; children?: React.ReactNode }) {
    return <Text>{`guard:${guard}`}</Text>;
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

// The two Protected blocks are, in order: [sign-in screen, the app]. Exactly one is open.
const guards = () => screen.getAllByText(/^guard:/).map((n) => n.props.children);

test('signed out, only the sign-in screen is reachable', async () => {
  mockReady = true;
  await SecureStore.deleteItemAsync('freeman.session');
  await render(<RootLayout />);
  expect(await screen.findByText('router-stack')).toBeTruthy();
  expect(guards()).toEqual(['guard:true', 'guard:false']);
});

test('with a saved session, only the app is reachable', async () => {
  mockReady = true;
  await SecureStore.setItemAsync('freeman.session', JSON.stringify({ refreshToken: 'r', email: 'a@b.co' }));
  await render(<RootLayout />);
  expect(await screen.findByText('router-stack')).toBeTruthy();
  expect(guards()).toEqual(['guard:false', 'guard:true']);
});

test('nothing is drawn while the saved session is still being read', async () => {
  mockReady = true;
  useAuth.setState({ status: 'restoring', email: null });
  let release!: (v: string | null) => void;
  (SecureStore.getItemAsync as jest.Mock).mockReturnValueOnce(new Promise((r) => (release = r)));
  await render(<RootLayout />);
  expect(screen.queryByText('router-stack')).toBeNull();
  release(null);
  expect(await screen.findByText('router-stack')).toBeTruthy();
});
