import { describe, expect, it } from 'vitest';
import { CardInputSchema } from './gifts.js';
import { CustomSlugSchema, slugify } from './slug.js';

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
    expect(CustomSlugSchema.safeParse('te-quiero-ana').success).toBe(true);
    for (const bad of ['ab', 'Hello', 'a--b', '-abc', 'abc-', 'con espacio', 'create', 'api']) {
      expect(CustomSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
