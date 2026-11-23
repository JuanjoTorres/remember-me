import type { Card } from '@remember-me/shared-types';
import { describe, expect, it } from 'vitest';
import { canAdvance, initialStory, mediaAhead, stepsOf, storyReducer } from './stories';

const photo = (id: string, imageUrl: string | null): Card => ({
  id,
  position: 0,
  type: 'PHOTO_TEXT',
  payload: { text: id, imageUrl },
});
const audio = (id: string): Card => ({
  id,
  position: 0,
  type: 'AUDIO_NOTE',
  payload: { audioUrl: `${id}.m4a`, imageUrl: `${id}.webp`, caption: '' },
});
const trivia = (id: string): Card => ({
  id,
  position: 0,
  type: 'TRIVIA',
  payload: { question: 'q', options: ['a', 'b'], correctIndex: 0, successMessage: '' },
});

describe('story navigation', () => {
  const steps = stepsOf({ cards: [photo('p1', null), trivia('t1'), photo('p2', null)] });

  it('goes cover, cards, reveal', () => {
    expect(steps.map((step) => step.kind)).toEqual(['cover', 'card', 'card', 'card', 'reveal']);
  });

  it('moves forwards and backwards within bounds', () => {
    let state = storyReducer(steps, initialStory, { type: 'previous' });
    expect(state.index).toBe(0);
    state = storyReducer(steps, state, { type: 'next' });
    state = storyReducer(steps, state, { type: 'next' });
    expect(state.index).toBe(2);
    expect(storyReducer(steps, state, { type: 'previous' }).index).toBe(1);
  });

  it('holds the recipient on a trivia until it is solved', () => {
    const atTrivia = { index: 2, solved: [] };
    expect(canAdvance(steps, atTrivia)).toBe(false);
    expect(storyReducer(steps, atTrivia, { type: 'next' })).toBe(atTrivia);

    const solved = storyReducer(steps, atTrivia, { type: 'solve', cardId: 't1' });
    expect(canAdvance(steps, solved)).toBe(true);
    expect(storyReducer(steps, solved, { type: 'next' }).index).toBe(3);
    // Coming back to a solved trivia does not block again.
    expect(canAdvance(steps, { ...solved, index: 2 })).toBe(true);
  });

  it('stops at the reveal and can start over', () => {
    const atReveal = { index: 4, solved: ['t1'] };
    expect(canAdvance(steps, atReveal)).toBe(false);
    expect(storyReducer(steps, atReveal, { type: 'next' })).toBe(atReveal);
    expect(storyReducer(steps, atReveal, { type: 'restart' })).toEqual(initialStory);
  });
});

describe('mediaAhead', () => {
  const steps = stepsOf({
    cards: [photo('p1', 'p1.webp'), audio('a1'), trivia('t1'), photo('p2', 'p2.webp')],
  });

  it('returns the media of the next two steps, not of the current one', () => {
    expect(mediaAhead(steps, 0, null)).toEqual({
      images: ['p1.webp', 'a1.webp'],
      audio: ['a1.m4a'],
    });
    expect(mediaAhead(steps, 1, null)).toEqual({ images: ['a1.webp'], audio: ['a1.m4a'] });
  });

  it('includes the reveal photo when the reveal is coming up', () => {
    expect(mediaAhead(steps, 3, 'reveal.webp')).toEqual({
      images: ['p2.webp', 'reveal.webp'],
      audio: [],
    });
    expect(mediaAhead(steps, 5, 'reveal.webp')).toEqual({ images: [], audio: [] });
  });

  it('looks as far ahead as asked', () => {
    expect(mediaAhead(steps, 0, null, 1)).toEqual({ images: ['p1.webp'], audio: [] });
  });
});
