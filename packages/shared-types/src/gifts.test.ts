import { describe, expect, it } from 'vitest';
import { CardInputSchema } from './gifts.js';
import {
  addMonths,
  addYears,
  draftExpiry,
  editableUntil,
  EDIT_GRACE_HOURS,
  freeGiftExpiry,
} from './lifecycle.js';
import {
  CodeSchema,
  CUSTOM_CODE_LENGTH,
  customLink,
  CustomNameSchema,
  GIFT_CODE_LENGTH,
  GiftLinkSchema,
  parseLink,
  randomCode,
  randomCodeCharacters,
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

  it('reads a custom link: a code, then the name', () => {
    expect(parseLink('7k2m/for/ana-luis')).toEqual({ code: '7k2m', name: 'ana-luis' });
    expect(parseLink('x9k2bd7m/for/ana-2026')).toEqual({ code: 'x9k2bd7m', name: 'ana-2026' });
    expect(customLink('7k2m', 'ana-luis')).toBe('7k2m/for/ana-luis');
  });

  it('refuses a custom link with a bad name', () => {
    for (const name of ['ab', 'Hello', 'a--b', '-abc', 'abc-', 'con espacio', 'a'.repeat(41)]) {
      expect(parseLink(`7k2m/for/${name}`), name).toBeNull();
    }
  });

  it('refuses a custom link without a real code in front', () => {
    for (const bad of [
      'luis/for/ana', // a word: no digit
      'mama/for/te-quiero',
      '7k2/for/ana-luis', // too short
      'a7k2/for/ana-luis', // a vowel is not in the alphabet
      '7K2M/for/ana-luis',
      '7k2m/ana-luis',
      '7k2m/for/ana/luis',
    ]) {
      expect(parseLink(bad), bad).toBeNull();
    }
  });

  it('lets a creator choose a name, and only a name, for a custom link', () => {
    for (const name of ['ana-luis', 'te-quiero-ana', 'ana-2026', 'abc']) {
      expect(CustomNameSchema.safeParse(name).success, name).toBe(true);
    }
    for (const bad of [
      'ab',
      'Ana Luis',
      'a--b',
      'a'.repeat(41),
      // Reserved words.
      'create',
      'api',
      'remember-me',
      // A whole link: the code is never the creator's to choose.
      '7k2m/for/ana-luis',
      '2222/for/ana',
    ]) {
      expect(CustomNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('tells a generated link from a custom one, and from anything else', () => {
    expect(parseLink('x9k2bd7m')).toEqual({ code: 'x9k2bd7m', name: null });
    for (const link of ['x9k2bd7m', '7k2m/for/ana-luis']) {
      expect(GiftLinkSchema.safeParse(link).success, link).toBe(true);
    }
    for (const bad of ['create', 'privacy', 'wp-login.php', 'sarah-x9k2bd7m', 'bcdfghjk', '']) {
      expect(parseLink(bad), bad).toBeNull();
      expect(GiftLinkSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('draws the characters of a code without favouring any', () => {
    const counts = new Map<string, number>();
    for (let batch = 0; batch < 100; batch += 1) {
      for (const character of randomCodeCharacters(27_000)) {
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

  it('generates codes of the length asked for, always with a digit, and not repeated', () => {
    const codes = Array.from({ length: 500 }, () => randomCode(CUSTOM_CODE_LENGTH));
    for (const code of codes) {
      expect(code).toHaveLength(CUSTOM_CODE_LENGTH);
      expect(code).toMatch(/[0-9]/);
      expect(CodeSchema.safeParse(code).success, code).toBe(true);
      expect(parseLink(customLink(code, 'laura'))).toEqual({ code, name: 'laura' });
    }
    expect(new Set(codes).size).toBeGreaterThan(450);
    expect(randomCode()).toHaveLength(GIFT_CODE_LENGTH);
    expect(GiftLinkSchema.safeParse(randomCode()).success).toBe(true);
  });
});

describe('lifecycle dates', () => {
  const start = new Date('2026-03-01T10:00:00.000Z');

  it('gives a draft seven days and a free gift three months', () => {
    expect(draftExpiry(start).toISOString()).toBe('2026-03-08T10:00:00.000Z');
    expect(freeGiftExpiry(start).toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(addYears(start, -1).toISOString()).toBe('2025-03-01T10:00:00.000Z');
  });

  it('counts months to the same day, or to the end of a shorter month', () => {
    const at = (iso: string) => new Date(`${iso}T10:00:00.000Z`);
    expect(addMonths(at('2026-11-27'), 3).toISOString()).toBe('2027-02-27T10:00:00.000Z');
    expect(addMonths(at('2026-11-30'), 3).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addMonths(at('2027-11-30'), 3).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(at('2026-01-31'), 3).toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });

  it('ends the correction window after the grace period, or earlier when locked by hand', () => {
    const graceEnd = new Date(start.getTime() + EDIT_GRACE_HOURS * 3_600_000);
    expect(editableUntil(start)).toEqual(graceEnd);
    const lockedEarly = new Date('2026-03-01T12:00:00.000Z');
    expect(editableUntil(start, lockedEarly)).toEqual(lockedEarly);
    expect(editableUntil(start, new Date('2026-04-01T00:00:00.000Z'))).toEqual(graceEnd);
  });
});
