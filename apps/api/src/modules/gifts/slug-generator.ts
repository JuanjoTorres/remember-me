import { SLUG_MAX_LENGTH, slugify } from '@remember-me/shared-types';
import { customAlphabet } from 'nanoid';

// No vowels and no look-alike characters: codes stay easy to read and never spell a word.
const randomCode = customAlphabet('bcdfghjkmnpqrstvwxz23456789', 6);

/** Human-friendly generated slug, e.g. "sarah-x9k2bd". Falls back to "gift-…" without a name. */
export function generateSlug(recipientName: string): string {
  const code = randomCode();
  const base = slugify(recipientName)
    .slice(0, SLUG_MAX_LENGTH - code.length - 1)
    .replace(/-+$/, '');
  return `${base || 'gift'}-${code}`;
}
