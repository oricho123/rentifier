import { createHash } from 'node:crypto';

/**
 * SHA-256 of the trimmed seed cookie string. Used both to detect when the
 * operator's FB_COOKIES_N secret changes (re-seed a warm profile) and to record
 * the cookie baseline at disable time so a later change can auto re-enable the account.
 */
export function hashSeedCookies(seedCookies: string): string {
  return createHash('sha256').update(seedCookies.trim(), 'utf8').digest('hex');
}
