import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="holding/[ticker]" options={{ headerShown: true, title: 'Position' }} />
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
    </QueryClientProvider>
  );
}
