import type { Card, PublicGift } from '@remember-me/shared-types';

/** One screen of the experience: the cover, each card of the story, then the surprise. */
export type Step = { kind: 'cover' } | { kind: 'card'; card: Card } | { kind: 'reveal' };

export function stepsOf(gift: Pick<PublicGift, 'cards'>): Step[] {
  return [
    { kind: 'cover' },
    ...gift.cards.map((card) => ({ kind: 'card' as const, card })),
    { kind: 'reveal' },
  ];
}

export interface StoryState {
  index: number;
  /** Ids of the trivia cards answered correctly; a trivia blocks the way until it is solved. */
  solved: string[];
}

export type StoryAction =
  { type: 'next' } | { type: 'previous' } | { type: 'solve'; cardId: string } | { type: 'restart' };

export const initialStory: StoryState = { index: 0, solved: [] };

/** Whether the recipient may leave the current step forwards. */
export function canAdvance(steps: Step[], state: StoryState): boolean {
  const step = steps[state.index];
  if (!step || state.index >= steps.length - 1) return false;
  return !(
    step.kind === 'card' &&
    step.card.type === 'TRIVIA' &&
    !state.solved.includes(step.card.id)
  );
}

export function storyReducer(steps: Step[], state: StoryState, action: StoryAction): StoryState {
  switch (action.type) {
    case 'next':
      return canAdvance(steps, state) ? { ...state, index: state.index + 1 } : state;
    case 'previous':
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case 'solve':
      return state.solved.includes(action.cardId)
        ? state
        : { ...state, solved: [...state.solved, action.cardId] };
    case 'restart':
      return initialStory;
  }
}

export interface MediaToPreload {
  images: string[];
  audio: string[];
}

function mediaOf(step: Step | undefined, revealImageUrl: string | null): MediaToPreload {
  if (!step || step.kind === 'cover') return { images: [], audio: [] };
  if (step.kind === 'reveal') return { images: revealImageUrl ? [revealImageUrl] : [], audio: [] };
  const { card } = step;
  if (card.type === 'TRIVIA') return { images: [], audio: [] };
  return {
    images: card.payload.imageUrl ? [card.payload.imageUrl] : [],
    audio: card.type === 'AUDIO_NOTE' ? [card.payload.audioUrl] : [],
  };
}

/** Media of the steps that follow the current one, nearest first. */
export function mediaAhead(
  steps: Step[],
  index: number,
  revealImageUrl: string | null,
  ahead = 2,
): MediaToPreload {
  const upcoming = steps
    .slice(index + 1, index + 1 + ahead)
    .map((step) => mediaOf(step, revealImageUrl));
  return {
    images: upcoming.flatMap((media) => media.images),
    audio: upcoming.flatMap((media) => media.audio),
  };
}
