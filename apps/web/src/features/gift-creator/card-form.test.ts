import { CardInputSchema } from '@remember-me/shared-types';
import { describe, expect, it } from 'vitest';
import { fitWithin } from './compress-image';
import { type CardFormState, toCardInput } from './components/CardSheet';

const form = (overrides: Partial<CardFormState>): CardFormState => ({
  text: '',
  imageUrl: null,
  audioUrl: null,
  caption: '',
  question: '',
  options: ['', ''],
  correctIndex: 0,
  successMessage: '',
  ...overrides,
});

describe('toCardInput', () => {
  it('drops empty trivia answers and keeps pointing at the correct one', () => {
    const input = toCardInput(
      'TRIVIA',
      form({ question: 'Where?', options: ['', 'Porto', '', 'Lisbon'], correctIndex: 3 }),
    );
    expect(CardInputSchema.parse(input)).toMatchObject({
      type: 'TRIVIA',
      payload: { options: ['Porto', 'Lisbon'], correctIndex: 1 },
    });
  });

  it('is not valid with a single answer or without audio', () => {
    expect(
      CardInputSchema.safeParse(
        toCardInput('TRIVIA', form({ question: 'Where?', options: ['Porto', ''] })),
      ).success,
    ).toBe(false);
    expect(
      CardInputSchema.safeParse(toCardInput('AUDIO_NOTE', form({ caption: 'Listen' }))).success,
    ).toBe(false);
  });

  it('accepts a photo card with only text', () => {
    expect(
      CardInputSchema.safeParse(toCardInput('PHOTO_TEXT', form({ text: 'Hello' }))).success,
    ).toBe(true);
    expect(CardInputSchema.safeParse(toCardInput('PHOTO_TEXT', form({}))).success).toBe(false);
  });
});

describe('fitWithin', () => {
  it('scales the longest edge down and keeps the proportions', () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin({ width: 3000, height: 4000 }, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges', () => {
    expect(fitWithin({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
  });
});
