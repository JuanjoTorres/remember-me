import { z } from 'zod';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** Words the name of a custom link may not be. */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'create',
  'for',
  'help',
  'new',
  'null',
  'privacy',
  'remember',
  'remember-me',
  'support',
  'terms',
  'undefined',
];

/** The name of a custom link: lowercase letters, digits and single hyphens; no hyphen at either end. */
export const SlugSchema = z
  .string()
  .min(SLUG_MIN_LENGTH)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * A gift's link is its only secret. Two shapes, both starting with a random code:
 * - generated: the code alone, "x9k2bd7m" (`kardoo.me/x9k2bd7m`);
 * - custom, a paid extra: a short code, then the name the creator chose, "7k2m/for/ana-luis"
 *   (`kardoo.me/7k2m/for/ana-luis`).
 * The stored slug is the path of the link without its leading slash.
 */

/** Length of the code of a generated link: long enough that trying codes finds nothing. */
export const GIFT_CODE_LENGTH = 8;
/** Length of the code in front of a custom link; the name after it does the rest. */
export const CUSTOM_CODE_LENGTH = 4;
/** Longest code a link may start with. */
export const CODE_MAX_LENGTH = 12;
/** What separates the code of a custom link from its name. */
export const CUSTOM_LINK_SEPARATOR = '/for/';

// No vowels and no look-alike characters: codes stay easy to read and never spell a word.
const CODE_ALPHABET = 'bcdfghjkmnpqrstvwxz23456789';

/** Web Crypto, present in browsers and in Node; declared here because this package loads no platform types. */
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array };

/** Random bytes at or above this would favour the first letters of the alphabet: they are redrawn. */
const UNBIASED_BYTES = 256 - (256 % CODE_ALPHABET.length);

/** Random characters of the code alphabet, each as likely as any other. */
export function randomCodeCharacters(length: number): string {
  let characters = '';
  while (characters.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(Math.min(length, 65_536)))) {
      if (byte < UNBIASED_BYTES && characters.length < length) {
        characters += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }
  return characters;
}

/**
 * Random code of a link. It always has a digit, so it can never be taken for a word or for a page
 * of the site, and it cannot be worked out from anything about the gift.
 */
export function randomCode(length: number = GIFT_CODE_LENGTH): string {
  for (;;) {
    const code = randomCodeCharacters(length);
    if (/[0-9]/.test(code)) return code;
  }
}

/** A code as `randomCode` makes them: characters of the code alphabet, at least one digit. */
export const CodeSchema = z
  .string()
  .min(CUSTOM_CODE_LENGTH)
  .max(CODE_MAX_LENGTH)
  .regex(new RegExp(`^[${CODE_ALPHABET}]+$`))
  .regex(/[0-9]/);

/** The stored slug of a custom link: "7k2m/for/ana-luis". */
export function customLink(code: string, name: string): string {
  return `${code}${CUSTOM_LINK_SEPARATOR}${name}`;
}

/** Splits a stored slug into its code and, for a custom link, its name. `null` when it is neither. */
export function parseLink(slug: string): { code: string; name: string | null } | null {
  const cut = slug.indexOf(CUSTOM_LINK_SEPARATOR);
  const code = cut === -1 ? slug : slug.slice(0, cut);
  const name = cut === -1 ? null : slug.slice(cut + CUSTOM_LINK_SEPARATOR.length);
  if (!CodeSchema.safeParse(code).success) return null;
  if (name !== null && !SlugSchema.safeParse(name).success) return null;
  return { code, name };
}

/** Any link a gift can have, generated or custom. */
export const GiftLinkSchema = z.string().refine((slug) => parseLink(slug) !== null, {
  message: 'Not a gift link',
});

/**
 * A custom link, as stored: a code, then the name chosen by the creator ("7k2m/for/ana-luis").
 * The code in front keeps a gift from being found by trying common names.
 */
export const CustomSlugSchema = z
  .string()
  .refine((slug) => (parseLink(slug)?.name ?? null) !== null, {
    message: 'A custom link is a code followed by /for/ and a name',
  })
  .refine((slug) => !RESERVED_SLUGS.includes(parseLink(slug)?.name ?? ''), {
    message: 'This name is reserved',
  });

/**
 * Turns free text into slug form: "Te quiero, Ana!" -> "te-quiero-ana".
 * The result can be shorter than a valid slug (even empty); validate it before using it.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export const SlugAvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  reason: z.enum(['INVALID', 'RESERVED', 'TAKEN']).optional(),
});
export type SlugAvailability = z.infer<typeof SlugAvailabilitySchema>;
