/**
 * The one place a handled error is reported. Today it is local only: it logs in development and
 * does nothing in release builds, so no error detail ever leaves the device.
 *
 * Every caller goes through here (the error boundaries, query error handlers), so adding a
 * crash-reporting service later means changing this function and nothing else. Anything sent
 * off-device must first be stripped of money and secrets (amounts, prices, share counts, tokens).
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.error('[freeman] handled error:', error, context ?? '');
}
