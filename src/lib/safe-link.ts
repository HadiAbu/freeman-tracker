import { Linking } from 'react-native';

/** Only https links are ever opened: headlines come from third parties. */
export function isSafeHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export async function openSafeLink(url: string): Promise<boolean> {
  if (!isSafeHttpsUrl(url)) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
