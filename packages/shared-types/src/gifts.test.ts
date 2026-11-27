import { describe, expect, it } from 'vitest';
import { CardInputSchema } from './gifts.js';
import {
  addYears,
  draftExpiry,
  editableUntil,
  EDIT_GRACE_HOURS,
  freeGiftExpiry,
} from './lifecycle.js';
import {
  CustomSlugSchema,
  GENERATED_SLUG_SUFFIX_LENGTH,
  joinSlug,
  randomSlugSuffix,
  SLUG_MAX_LENGTH,
  SLUG_SUFFIX_LENGTH,
  splitSlug,
  slugify,
} from './slug.js';

describe('card contracts', () => {
  it('rejects an empty photo card', () => {
    expect(CardInputSchema.safeParse({ type: 'PHOTO_TEXT', payload: {} }).success).toBe(false);
    expect(
      CardInputSchema.safeParse({ type: 'PHOTO_TEXT', payload: { text: '  hi  ' } }).data,
    ).toEqual({ type: 'PHOTO_TEXT', payload: { text: 'hi', imageUrl: null } });
  });

  it('requires the correct answer to be one of the options', () => {
    const trivia = { question: 'Where did we meet?', options: ['Lisbon', 'Porto'] };
    expect(
      CardInputSchema.safeParse({ type: 'TRIVIA', payload: { ...trivia, correctIndex: 1 } })
        .success,
    ).toBe(true);
    expect(
      CardInputSchema.safeParse({ type: 'TRIVIA', payload: { ...trivia, correctIndex: 2 } })
        .success,
    ).toBe(false);
  });

  it('rejects NUL characters, which the database cannot store', () => {
    expect(
      CardInputSchema.safeParse({ type: 'PHOTO_TEXT', payload: { text: 'a\u0000b' } }).success,
    ).toBe(false);
  });

  it('does not accept a payload of another card type', () => {
    expect(
      CardInputSchema.safeParse({ type: 'AUDIO_NOTE', payload: { text: 'no audio here' } }).success,
    ).toBe(false);
  });
});

describe('slugs', () => {
  it('slugifies accents, punctuation and spaces', () => {
    expect(slugify('Te quiero, Ana!')).toBe('te-quiero-ana');
    expect(slugify('  Iñaki & Zoë  ')).toBe('inaki-zoe');
    expect(slugify('🎁')).toBe('');
  });

  it('validates custom slugs', () => {
    expect(CustomSlugSchema.safeParse('te-quiero-ana-x9k2').success).toBe(true);
    expect(CustomSlugSchema.safeParse('ana-2026').success).toBe(true);
    for (const bad of ['ab', 'Hello', 'a--b', '-abc', 'abc-', 'con espacio']) {
      expect(CustomSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('refuses a custom slug without an ending of at least four characters', () => {
    for (const bad of ['laura', 'te-quiero-ana', 'laura-x9k', 'x9k2']) {
      expect(CustomSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('refuses a reserved name, whatever its ending', () => {
    for (const bad of ['create-x9k2', 'api-2026', 'remember-me-abcd']) {
      expect(CustomSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('splits and joins a name and its ending', () => {
    expect(splitSlug('te-quiero-ana-x9k2')).toEqual({ base: 'te-quiero-ana', suffix: 'x9k2' });
    expect(splitSlug('laura')).toBeNull();
    expect(splitSlug('laura-x9k')).toBeNull();
    expect(joinSlug('laura', 'x9k2')).toBe('laura-x9k2');
    const long = joinSlug('a'.repeat(60), 'x9k2');
    expect(long).toHaveLength(SLUG_MAX_LENGTH);
    expect(long.endsWith('-x9k2')).toBe(true);
    expect(joinSlug('ana-'.repeat(9), 'x9k2')).not.toContain('--');
  });

  it('generates endings of the length asked for, without favouring any character', () => {
    expect(randomSlugSuffix(GENERATED_SLUG_SUFFIX_LENGTH)).toMatch(/^[a-z0-9]{8}$/);
    const counts = new Map<string, number>();
    for (let batch = 0; batch < 100; batch += 1) {
      for (const character of randomSlugSuffix(27_000)) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    // 27 characters, about 100 000 times each, give or take a few hundred. Taking a random byte
    // modulo 27 would put 13 of them near 105 500 and the rest near 94 900.
    expect(counts.size).toBe(27);
    for (const [character, count] of counts) {
      expect(count, character).toBeGreaterThan(97_500);
      expect(count, character).toBeLessThan(102_500);
    }
  });

  it('generates endings that are valid and not repeated', () => {
    const endings = Array.from({ length: 50 }, randomSlugSuffix);
    for (const ending of endings) {
      expect(ending).toMatch(/^[a-z0-9]+$/);
      expect(ending).toHaveLength(SLUG_SUFFIX_LENGTH);
      expect(CustomSlugSchema.safeParse(`laura-${ending}`).success).toBe(true);
    }
    expect(new Set(endings).size).toBeGreaterThan(40);
  });
});

describe('lifecycle dates', () => {
  const start = new Date('2026-03-01T10:00:00.000Z');

  it('gives a draft seven days and a free gift one year', () => {
    expect(draftExpiry(start).toISOString()).toBe('2026-03-08T10:00:00.000Z');
    expect(freeGiftExpiry(start).toISOString()).toBe('2027-03-01T10:00:00.000Z');
    expect(addYears(start, -1).toISOString()).toBe('2025-03-01T10:00:00.000Z');
  });

  it('ends the correction window after the grace period, or earlier when locked by hand', () => {
    const graceEnd = new Date(start.getTime() + EDIT_GRACE_HOURS * 3_600_000);
    expect(editableUntil(start)).toEqual(graceEnd);
    const lockedEarly = new Date('2026-03-01T12:00:00.000Z');
    expect(editableUntil(start, lockedEarly)).toEqual(lockedEarly);
    expect(editableUntil(start, new Date('2026-04-01T00:00:00.000Z'))).toEqual(graceEnd);
  });
});
