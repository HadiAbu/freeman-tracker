import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import React from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/splash-overlay';
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from '@/lib/query-client';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE, buster: PERSIST_BUSTER }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
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
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
