import { GIFT_CODE_LENGTH, randomCode } from '@remember-me/shared-types';

/**
 * The link a gift is created with: a random code, e.g. "x9k2bd7m". The link is all that protects a
 * gift, so the code is long: nobody finds one by trying codes. It says nothing about the gift.
 */
export function generateSlug(): string {
  return randomCode(GIFT_CODE_LENGTH);
}
