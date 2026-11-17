import { confidenceLabel, stanceSpoken, stanceTitle } from '@/lib/stance';

test('titles never read as an instruction', () => {
  expect(stanceTitle('buy')).toBe('Lean: buy');
  expect(stanceTitle('hold')).toBe('Lean: hold');
  expect(stanceTitle('sell')).toBe('Lean: sell');
  expect(stanceTitle('unclear')).toBe('No clear lean');
});

test('confidence and spoken labels', () => {
  expect(confidenceLabel('medium')).toBe('medium confidence');
  expect(stanceSpoken('hold', 'medium')).toBe('Lean: hold, medium confidence');
  expect(stanceSpoken('unclear', 'low')).toBe('No clear lean from the news');
});
