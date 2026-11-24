import { initMonitoring, reportError, scrub } from '@/lib/monitoring';

describe('scrub', () => {
  it('hides amounts, prices, share counts and secrets at any depth', () => {
    const out = scrub({
      ticker: 'AAPL',
      shares: 12,
      nested: { avg_cost: 100, list: [{ price: 5, note: 'ok' }], token: 'abc' },
    });
    expect(out).toEqual({
      ticker: 'AAPL',
      shares: '[scrubbed]',
      nested: { avg_cost: '[scrubbed]', list: [{ price: '[scrubbed]', note: 'ok' }], token: '[scrubbed]' },
    });
  });

  it('leaves primitives and null alone', () => {
    expect(scrub(null)).toBeNull();
    expect(scrub('text')).toBe('text');
  });
});

describe('without a DSN', () => {
  it('does not start and reporting is a silent no-op', () => {
    expect(initMonitoring()).toBe(false);
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });
});
