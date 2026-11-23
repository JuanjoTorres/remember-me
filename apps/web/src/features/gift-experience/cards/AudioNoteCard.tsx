'use client';

import type { AudioNotePayload } from '@remember-me/shared-types';
import { useEffect, useRef, useState } from 'react';

interface AudioNoteCardProps {
  payload: AudioNotePayload;
  labels: { play: string; pause: string };
}

/** A voice note with one large play button. Starts by itself when the browser allows it. */
export function AudioNoteCard({ payload, labels }: AudioNoteCardProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const element = audio.current;
    // The tap that brought the recipient here counts as a gesture in most browsers; if it does
    // not, the play button is right there.
    element?.play().catch(() => undefined);
    return () => element?.pause();
  }, []);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  return (
    <div className="flex w-full flex-col items-center">
      <audio
        ref={audio}
        src={payload.audioUrl}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setProgress(1)}
        onTimeUpdate={(event) => {
          const { currentTime, duration } = event.currentTarget;
          if (Number.isFinite(duration) && duration > 0) setProgress(currentTime / duration);
        }}
      />
      {payload.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- user media from object storage
        <img
          src={payload.imageUrl}
          alt=""
          className="mb-6 max-h-[40dvh] w-full rounded-3xl object-cover shadow-2xl"
        />
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? labels.pause : labels.play}
        className="bg-ember relative z-20 flex size-24 items-center justify-center rounded-full text-3xl text-white shadow-2xl"
      >
        <span aria-hidden className={playing ? '' : 'translate-x-0.5'}>
          {playing ? '❚❚' : '▶'}
        </span>
      </button>
      <div className="bg-paper/20 mt-6 h-1 w-40 overflow-hidden rounded-full" aria-hidden>
        <div
          className="bg-paper h-full rounded-full"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      {payload.caption && (
        <p className="mt-5 text-center text-lg leading-snug text-balance">{payload.caption}</p>
      )}
    </div>
  );
}
