import type { Card } from '@remember-me/shared-types';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepsOf } from './stories';
import { usePreloadMedia } from './usePreloadMedia';

const cards: Card[] = [
  {
    id: 'c1',
    position: 0,
    type: 'PHOTO_TEXT',
    payload: { text: '', imageUrl: 'https://media.test/1.webp' },
  },
  {
    id: 'c2',
    position: 1,
    type: 'AUDIO_NOTE',
    payload: { audioUrl: 'https://media.test/2.m4a', imageUrl: null, caption: '' },
  },
  {
    id: 'c3',
    position: 2,
    type: 'PHOTO_TEXT',
    payload: { text: '', imageUrl: 'https://media.test/3.webp' },
  },
];
const steps = stepsOf({ cards });

describe('usePreloadMedia', () => {
  const requested: string[] = [];

  beforeEach(() => {
    requested.length = 0;
    class FakeMedia {
      preload = '';
      decoding = '';
      set src(url: string) {
        requested.push(url);
      }
    }
    vi.stubGlobal('Image', FakeMedia);
    vi.stubGlobal('Audio', FakeMedia);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests the media of the following cards while the current one is shown', () => {
    const { rerender } = renderHook(
      ({ index }) => usePreloadMedia(steps, index, 'https://media.test/reveal.webp'),
      {
        initialProps: { index: 0 },
      },
    );
    // On the cover: the first photo and the voice note are already on their way.
    expect(requested).toEqual(['https://media.test/1.webp', 'https://media.test/2.m4a']);

    rerender({ index: 1 });
    expect(requested).toEqual([
      'https://media.test/1.webp',
      'https://media.test/2.m4a',
      'https://media.test/3.webp',
    ]);

    rerender({ index: 2 });
    expect(requested).toContain('https://media.test/reveal.webp');
  });

  it('never requests the same file twice, also when going back', () => {
    const { rerender } = renderHook(({ index }) => usePreloadMedia(steps, index, null), {
      initialProps: { index: 0 },
    });
    rerender({ index: 1 });
    rerender({ index: 0 });
    rerender({ index: 1 });
    expect(requested).toHaveLength(new Set(requested).size);
  });
});
