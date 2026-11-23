import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The secret that proves edit access. Only its hash is stored. */
export function generateEditToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashEditToken(token) };
}

export function hashEditToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function editTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashEditToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
