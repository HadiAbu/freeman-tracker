import { clearSession, loadSession, saveSession } from '@/lib/token-storage';
import { useAuth } from '@/stores/auth';
import { useTradeDraft } from '@/stores/trade-draft';

// The API address is not a secret. (Unlike the shared key this replaces: nothing in the bundle can
// get into the account any more.)
const BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// The access token is short-lived and only ever held in memory. The refresh token is in the keychain.
// Things that hold the signed-in user's data register here to be wiped on sign-out (the query
// cache does, see query-client.ts). Registering, rather than importing them, keeps this module
// free of the network and storage listeners they set up, so screens that only need to call the API
// stay easy to test.
type Cleanup = () => void | Promise<void>;
const cleanups = new Set<Cleanup>();
export function onSessionEnd(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let inFlight: Promise<boolean> | null = null;

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!BASE_URL) throw new AuthError(0, 'App is not configured: set EXPO_PUBLIC_API_URL.');
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(0, `Could not reach the server at ${BASE_URL}.`);
  }
  if (res.status === 204) return undefined as T;
  let data: { detail?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    // keep the generic message below
  }
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) ? 'Check the email and password and try again.' : null;
    throw new AuthError(res.status, detail ?? `Request failed (${res.status})`);
  }
  return data as T;
}

async function adopt(tokens: Tokens, email: string) {
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  await saveSession({ refreshToken: tokens.refresh_token, email });
  useAuth.setState({ status: 'signedIn', email });
}

/** Call once at launch. A saved session means "signed in"; the access token is fetched on demand. */
export async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (!saved) {
    useAuth.setState({ status: 'signedOut', email: null });
    return;
  }
  // Signed in without a network round trip, so the app opens offline with the cached data.
  refreshToken = saved.refreshToken;
  useAuth.setState({ status: 'signedIn', email: saved.email });
}

export async function signIn(email: string, password: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await adopt(await post<Tokens>('/auth/login', { email: e, password }), e);
}

export async function register(email: string, password: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await adopt(await post<Tokens>('/auth/register', { email: e, password }), e);
}

/**
 * A valid access token, refreshing first if there is none. Null when signed out.
 * Throws AuthError(0) when offline, so a network problem never signs the user out.
 */
export async function getAccessToken(): Promise<string | null> {
  if (accessToken) return accessToken;
  if (!refreshToken) return null;
  await refreshSession();
  return accessToken;
}

/**
 * Trade the refresh token for a new pair. Returns false if the server rejected it (the session is
 * then ended). One refresh at a time: refresh tokens are single use, so two parallel refreshes
 * would make the second one look like a replay and kill the session.
 */
export function refreshSession(): Promise<boolean> {
  if (inFlight) return inFlight;
  const used = refreshToken;
  if (!used) return Promise.resolve(false);
  inFlight = (async () => {
    try {
      const tokens = await post<Tokens>('/auth/refresh', { refresh_token: used });
      await adopt(tokens, useAuth.getState().email ?? '');
      return true;
    } catch (e) {
      if (e instanceof AuthError && (e.status === 401 || e.status === 403)) {
        await endSession({ remote: false });
        return false;
      }
      throw e; // offline or a server error: stay signed in and let the caller report it
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Sign out: revoke the session on the server (best effort), then forget everything on the device.
 * Cached server data and the saved trade draft belong to the account, so they go too: the next
 * person to sign in on this device must not see them. (Display preferences stay.)
 */
export async function endSession({ remote }: { remote: boolean } = { remote: true }): Promise<void> {
  const token = refreshToken;
  accessToken = null;
  refreshToken = null;
  useAuth.setState({ status: 'signedOut', email: null });
  if (remote && token) {
    try {
      await post('/auth/logout', { refresh_token: token });
    } catch {
      // Offline: the token stays valid on the server until it expires, but it is gone from here.
    }
  }
  await clearSession();
  useTradeDraft.getState().clear();
  for (const fn of cleanups) {
    try {
      await fn();
    } catch {
      // One failing cleanup must not leave the others undone.
    }
  }
}
