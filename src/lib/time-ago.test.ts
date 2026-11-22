import { timeAgo } from '@/lib/time-ago';

const now = new Date('2026-11-17T12:00:00Z');

test.each([
  ['2026-11-17T11:59:40Z', 'just now'],
  ['2026-11-17T11:30:00Z', '30 min ago'],
  ['2026-11-17T09:00:00Z', '3 h ago'],
  ['2026-11-15T12:00:00Z', '2 d ago'],
])('%s -> %s', (iso, expected) => {
  expect(timeAgo(iso, now)).toBe(expected);
});

test('missing or invalid dates', () => {
  expect(timeAgo(null, now)).toBe('date unknown');
  expect(timeAgo('garbage', now)).toBe('date unknown');
  expect(timeAgo('2026-11-17T13:00:00Z', now)).toBe('just now'); // clock skew: future times clamp
});
