import { Linking } from 'react-native';

import { isSafeHttpsUrl, openSafeLink } from '@/lib/safe-link';

describe('isSafeHttpsUrl', () => {
  it('accepts https URLs only', () => {
    expect(isSafeHttpsUrl('https://example.com/a?b=1')).toBe(true);
    expect(isSafeHttpsUrl('http://example.com')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpsUrl('intent://scan/#Intent;end')).toBe(false);
    expect(isSafeHttpsUrl('not a url')).toBe(false);
    expect(isSafeHttpsUrl('')).toBe(false);
  });
});

describe('openSafeLink', () => {
  beforeEach(() => jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined));
  // The RN jest preset already mocks Linking.openURL, so spyOn returns that same mock and
  // restoreAllMocks does not clear its calls; clear them explicitly.
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('opens a safe link', async () => {
    await expect(openSafeLink('https://example.com')).resolves.toBe(true);
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com');
  });

  it('refuses an unsafe link without calling the OS', async () => {
    await expect(openSafeLink('javascript:alert(1)')).resolves.toBe(false);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('reports false when the OS cannot open it', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no handler'));
    await expect(openSafeLink('https://example.com')).resolves.toBe(false);
  });
});
