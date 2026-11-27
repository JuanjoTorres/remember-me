import { z } from 'zod';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** Paths and words a custom slug may not take. */
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

/** Lowercase letters, digits and single hyphens; no hyphen at either end. */
export const SlugSchema = z
  .string()
  .min(SLUG_MIN_LENGTH)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * Length of the random code that ends every generated link ("laura-x9k2bd7m"). The link is the only
 * secret of a gift, so the code is long enough that trying codes behind a name finds nothing.
 */
export const GENERATED_SLUG_SUFFIX_LENGTH = 8;
/** Length of the random ending proposed for a custom link ("laura-x9k2"); the creator may type their own. */
export const SLUG_SUFFIX_LENGTH = 4;
/** A creator may type their own ending for a custom link, but never a shorter one. */
export const SLUG_SUFFIX_MIN_LENGTH = 4;

// No vowels and no look-alike characters: codes stay easy to read and never spell a word.
const SUFFIX_ALPHABET = 'bcdfghjkmnpqrstvwxz23456789';

/** Web Crypto, present in browsers and in Node; declared here because this package loads no platform types. */
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array };

/** Random bytes at or above this would favour the first letters of the alphabet: they are redrawn. */
const UNBIASED_BYTES = 256 - (256 % SUFFIX_ALPHABET.length);

/** Random ending of a link. It keeps links from colliding and from being guessed from a name. */
export function randomSlugSuffix(length: number = SLUG_SUFFIX_LENGTH): string {
  let suffix = '';
  while (suffix.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < UNBIASED_BYTES && suffix.length < length) {
        suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
      }
    }
  }
  return suffix;
}

export const SlugSuffixSchema = z
  .string()
  .min(SLUG_SUFFIX_MIN_LENGTH)
  .regex(/^[a-z0-9]+$/);

/** Splits "te-quiero-ana-x9k2" into its name and its ending. `null` when there is no valid ending. */
export function splitSlug(slug: string): { base: string; suffix: string } | null {
  const cut = slug.lastIndexOf('-');
  if (cut <= 0) return null;
  const suffix = slug.slice(cut + 1);
  return SlugSuffixSchema.safeParse(suffix).success ? { base: slug.slice(0, cut), suffix } : null;
}

/** Joins a name and an ending into a link, shortening the name so the result fits. */
export function joinSlug(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  const name = base.slice(0, Math.max(room, 0)).replace(/-+$/g, '');
  return name ? `${name}-${suffix}` : suffix;
}

/**
 * A link chosen by the creator: a name followed by an ending of at least `SLUG_SUFFIX_MIN_LENGTH`
 * letters or digits ("ana-y-luis-x9k2"), so that nobody finds a gift by trying common names.
 */
export const CustomSlugSchema = SlugSchema.refine((slug) => splitSlug(slug) !== null, {
  message: 'The link must end with a code of at least 4 letters or digits',
}).refine((slug) => !RESERVED_SLUGS.includes(splitSlug(slug)?.base ?? slug), {
  message: 'This link is reserved',
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
  /** Free links close to a taken one. Empty unless the reason is `TAKEN`. */
  suggestions: z.array(z.string()).default([]),
});

/** How many alternatives are offered for a taken link. */
export const SLUG_SUGGESTION_COUNT = 3;
export type SlugAvailability = z.infer<typeof SlugAvailabilitySchema>;
