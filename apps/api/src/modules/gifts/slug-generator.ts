import {
  CUSTOM_CODE_LENGTH,
  customLink,
  GIFT_CODE_LENGTH,
  randomCode,
} from '@remember-me/shared-types';

/**
 * The link a gift is created with: a random code, e.g. "x9k2bd7m". The link is all that protects a
 * gift, so the code is long: nobody finds one by trying codes. It says nothing about the gift.
 */
export function generateSlug(): string {
  return randomCode(GIFT_CODE_LENGTH);
}

/**
 * A custom link for the name a creator chose, e.g. "7k2m/for/ana-luis". The code in front is drawn
 * here, never taken from a request: nobody picks an easy one, and nobody finds a gift by trying
 * names.
 */
export function generateCustomLink(name: string): string {
  return customLink(randomCode(CUSTOM_CODE_LENGTH), name);
}
