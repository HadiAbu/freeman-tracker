import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { onSessionEnd } from '@/lib/session';

// Cached data older than this is dropped on restore. gcTime must be at least as long, or the
// cache is garbage collected before it can be persisted and restored.
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: PERSIST_MAX_AGE } },
});

// Saves successful query results to device storage so the app opens with the last known data
// (and keeps working offline) instead of a blank loading state. Mutations are not persisted:
// a trade or price is only saved once the server accepts it.
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'freeman-query-cache',
  throttleTime: 1_000,
});

// Bump when the shape of cached data changes, so an old cache is discarded instead of restored.
export const PERSIST_BUSTER = 'v1';

// React Native has no window focus event, so tell React Query when the app returns to the
// foreground. Stale data (older than staleTime) then refetches, e.g. after you log a price
// elsewhere. On web the browser's own visibility handling already does this.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}

// Pause queries while offline and refetch when the connection returns.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected ?? true);
  }),
);

// Cached server data belongs to the signed-in account. Signing out must empty memory and the copy
// on disk, or the next person to sign in on this device would see it.
onSessionEnd(async () => {
  queryClient.clear();
  await queryPersister.removeClient();
});
