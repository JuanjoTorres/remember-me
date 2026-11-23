'use client';

import { useEffect, useRef } from 'react';
import { mediaAhead, type Step } from './stories';

/**
 * While the recipient looks at one step, fetches the photos and audio of the next ones in the
 * background, so that advancing never shows a loading state on a slow mobile connection.
 */
export function usePreloadMedia(
  steps: Step[],
  index: number,
  revealImageUrl: string | null,
  ahead = 2,
): void {
  // Keeps the elements alive (a collected Image can cancel its request) and avoids repeats.
  const loaded = useRef(new Map<string, HTMLImageElement | HTMLAudioElement>());

  useEffect(() => {
    const { images, audio } = mediaAhead(steps, index, revealImageUrl, ahead);
    for (const url of images) {
      if (loaded.current.has(url)) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      loaded.current.set(url, image);
    }
    for (const url of audio) {
      if (loaded.current.has(url)) continue;
      const element = new Audio();
      element.preload = 'auto';
      element.src = url;
      loaded.current.set(url, element);
    }
  }, [steps, index, revealImageUrl, ahead]);
}
