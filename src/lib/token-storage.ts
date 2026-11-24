import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'freeman.session';

/** What survives an app restart: the refresh token (never the short-lived access token). */
export type StoredSession = { refreshToken: string; email: string };

// expo-secure-store has no web implementation. On web the session lives in memory only, so a page
// reload signs the user out. That is deliberate: localStorage is readable by any script on the
// page, which is exactly what the keychain is there to avoid.
let memory: StoredSession | null = null;
const native = Platform.OS !== 'web';

function parse(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    return typeof v.refreshToken === 'string' && typeof v.email === 'string'
      ? { refreshToken: v.refreshToken, email: v.email }
      : null;
  } catch {
    return null;
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  if (!native) return memory;
  try {
    return parse(await SecureStore.getItemAsync(KEY));
  } catch {
    // An unreadable keychain entry (restored backup, changed device) is a signed-out state, not a crash.
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!native) {
    memory = session;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  memory = null;
  if (!native) return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing to delete, or the keychain refused: the in-memory state is already cleared.
  }
}
