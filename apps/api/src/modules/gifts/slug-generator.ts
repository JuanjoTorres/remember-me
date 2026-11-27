import {
  GENERATED_SLUG_SUFFIX_LENGTH,
  joinSlug,
  randomSlugSuffix,
  slugify,
} from '@remember-me/shared-types';

/**
 * Human-friendly generated slug, e.g. "sarah-x9k2bd7m". The link is all that protects a gift, so its
 * random ending is long: nobody finds one by trying codes behind a name. Falls back to "gift-…"
 * without a name.
 */
export function generateSlug(recipientName: string): string {
  return joinSlug(slugify(recipientName) || 'gift', randomSlugSuffix(GENERATED_SLUG_SUFFIX_LENGTH));
}
