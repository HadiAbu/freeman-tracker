import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Keys that can hold money or position sizes. Events are scrubbed of these before they leave
// the device: crash reports must say what broke, never what the user owns.
const SENSITIVE_KEY = /amount|balance|price|shares|quantity|cost|value|total|password|token|secret/i;

/** Replaces the value of every sensitive-looking key, at any depth. Pure, so it is easy to test. */
export function scrub<T>(input: T, depth = 0): T {
  if (depth > 6 || input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => scrub(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[scrubbed]' : scrub(v, depth + 1);
  }
  return out as T;
}

let started = false;

/**
 * Starts crash reporting. Does nothing without EXPO_PUBLIC_SENTRY_DSN, so local dev, tests and CI
 * never touch the network. Safe to call more than once.
 */
export function initMonitoring(): boolean {
  if (started || !DSN) return false;
  started = true;

  Sentry.init({
    dsn: DSN,
    // Development builds are noisy and not representative of what users hit.
    enabled: !__DEV__,
    environment: Updates.channel ?? 'unknown',
    sendDefaultPii: false,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (crumb) => (crumb.data ? { ...crumb, data: scrub(crumb.data) } : crumb),
  });

  // Tie every event to the exact build and update that produced it, so a crash can be matched to
  // a staged rollout and the rollout halted.
  Sentry.setTag('release-channel', Updates.channel ?? 'none');
  Sentry.setTag('expo-update-id', Updates.updateId ?? 'embedded');
  Sentry.setTag('expo-is-embedded-update', String(Updates.isEmbeddedLaunch));
  return true;
}

/** Report a handled error. Silent when monitoring is off. */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!started) return;
  Sentry.captureException(error, context ? { extra: scrub(context) } : undefined);
}

/** Records an API failure as a breadcrumb: method, path and status only, never a body. */
export function recordApiFailure(path: string, status: number) {
  if (!started) return;
  Sentry.addBreadcrumb({ category: 'api', level: 'warning', message: `${path} -> ${status}` });
}

export { Sentry };
