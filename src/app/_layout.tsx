import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import React from 'react';
import { useColorScheme } from 'react-native';

import { AppErrorScreen } from '@/components/app-error-screen';
import { AnimatedSplashOverlay } from '@/components/splash-overlay';
import { initMonitoring } from '@/lib/monitoring';
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from '@/lib/query-client';
import { useStoresReady } from '@/stores';

// Runs once at startup, before the first render, so errors during launch are captured too.
initMonitoring();

// Expo Router renders this instead of the route when a screen throws while rendering.
export const ErrorBoundary = AppErrorScreen;

function Screens() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="holding/[ticker]" options={{ headerShown: true, title: 'Position' }} />
      <Stack.Screen name="analysis/[ticker]" options={{ headerShown: true, title: 'News analysis' }} />
      <Stack.Screen
        name="add-watch"
        options={{ presentation: 'modal', headerShown: true, title: 'Add to watchlist' }}
      />
      <Stack.Screen
        name="log-price"
        options={{ presentation: 'modal', headerShown: true, title: 'Log price' }}
      />
      <Stack.Screen
        name="add-trade"
        options={{ presentation: 'modal', headerShown: true, title: 'Add trade' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Saved settings (notably "hide balances") must be applied before the first screen draws,
  // or real amounts would flash on screen at every launch. The splash overlay covers the wait.
  const storesReady = useStoresReady();
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE, buster: PERSIST_BUSTER }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {storesReady ? <Screens /> : null}
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
