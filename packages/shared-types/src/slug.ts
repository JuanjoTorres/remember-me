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

export const CustomSlugSchema = SlugSchema.refine((slug) => !RESERVED_SLUGS.includes(slug), {
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
});
export type SlugAvailability = z.infer<typeof SlugAvailabilitySchema>;
