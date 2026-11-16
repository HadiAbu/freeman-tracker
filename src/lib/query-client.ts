import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// React Native has no window focus event, so tell React Query when the app returns to the
// foreground. Stale data (older than staleTime) then refetches, e.g. after you log a price
// elsewhere. On web the browser's own visibility handling already does this.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}
