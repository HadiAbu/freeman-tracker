import { create } from 'zustand';

/**
 * Who is signed in. Not persisted here: the refresh token lives in the keychain (see
 * token-storage) and this is rebuilt from it at launch.
 *  - restoring: still reading the keychain; show the splash, not the sign-in screen
 *  - signedOut: show the sign-in screen
 *  - signedIn:  show the app
 */
export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

type AuthState = { status: AuthStatus; email: string | null };

export const useAuth = create<AuthState>()(() => ({ status: 'restoring', email: null }));
