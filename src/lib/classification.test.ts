import { isAllUnassigned, mergeClassification } from '@/lib/classification';

describe('mergeClassification', () => {
  test('returns null when nothing was entered', () => {
    expect(mergeClassification(undefined, { sector: '  ', assetClass: '' })).toBeNull();
    expect(mergeClassification({ sector: 'Tech' }, { sector: '', assetClass: '' })).toBeNull();
  });

  test('a new ticker gets just what was entered', () => {
    expect(mergeClassification(undefined, { sector: ' Technology ', assetClass: 'Stock' })).toEqual({
      name: null,
      sector: 'Technology',
      asset_class: 'Stock',
    });
  });

  test('a blank field keeps the stored value instead of wiping it', () => {
    const existing = { name: 'Nvidia', sector: 'Technology', asset_class: 'Stock' };
    expect(mergeClassification(existing, { sector: '', assetClass: 'ETF' })).toEqual({
      name: 'Nvidia',
      sector: 'Technology',
      asset_class: 'ETF',
    });
  });

  test('an entered field overrides the stored value', () => {
    expect(mergeClassification({ sector: 'Old', asset_class: null }, { sector: 'New', assetClass: '' })).toEqual({
      name: null,
      sector: 'New',
      asset_class: null,
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
