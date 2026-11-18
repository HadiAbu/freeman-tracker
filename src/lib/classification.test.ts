import { enteredClassification, isAllUnassigned } from '@/lib/classification';

describe('enteredClassification', () => {
  test('returns null when nothing was entered', () => {
    expect(enteredClassification({ sector: '  ', assetClass: '' })).toBeNull();
  });

  test('includes only the fields that were entered, trimmed, never name or nulls', () => {
    expect(enteredClassification({ sector: ' Technology ', assetClass: '' })).toEqual({ sector: 'Technology' });
    expect(enteredClassification({ sector: '', assetClass: 'ETF' })).toEqual({ asset_class: 'ETF' });
    expect(enteredClassification({ sector: 'Tech', assetClass: 'Stock' })).toEqual({
      sector: 'Tech',
      asset_class: 'Stock',
    });
  });
});

describe('isAllUnassigned', () => {
  test('true only when every slice is Unassigned', () => {
    expect(isAllUnassigned([{ label: 'Unassigned' }])).toBe(true);
    expect(isAllUnassigned([{ label: 'Unassigned' }, { label: 'Tech' }])).toBe(false);
    expect(isAllUnassigned([])).toBe(false);
  });
});
