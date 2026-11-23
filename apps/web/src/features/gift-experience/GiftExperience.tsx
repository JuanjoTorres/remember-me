'use client';

import type { PublicGift } from '@remember-me/shared-types';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Reveal, type RevealLabels } from '@/features/gift-reveal/Reveal';
import { AudioNoteCard } from './cards/AudioNoteCard';
import { PhotoTextCard } from './cards/PhotoTextCard';
import { TriviaCard } from './cards/TriviaCard';
import {
  canAdvance,
  initialStory,
  type StoryAction,
  type StoryState,
  stepsOf,
  storyReducer,
} from './stories';
import { usePreloadMedia } from './usePreloadMedia';

/** Every text of the experience, resolved on the server in the gift's language. */
export interface ExperienceLabels {
  coverEyebrow: string;
  coverFor: string;
  coverFrom: string;
  coverStart: string;
  next: string;
  previous: string;
  play: string;
  pause: string;
  triviaWrong: string;
  triviaRight: string;
  continue: string;
  replay: string;
  watermark: string;
  reveal: RevealLabels;
}

/** Full-screen stories: cover, one card per tap, then the surprise. */
export function GiftExperience({ gift, labels }: { gift: PublicGift; labels: ExperienceLabels }) {
  const steps = useMemo(() => stepsOf(gift), [gift]);
  const [state, dispatch] = useReducer(
    (current: StoryState, action: StoryAction) => storyReducer(steps, current, action),
    initialStory,
  );
  const [revealed, setRevealed] = useState(false);
  const step = steps[state.index];
  const advance = canAdvance(steps, state);
  usePreloadMedia(steps, state.index, gift.reveal.imageUrl);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') dispatch({ type: 'next' });
      if (event.key === 'ArrowLeft') {
        // Leaving the surprise re-wraps it, so its "after" controls must go too.
        setRevealed(false);
        dispatch({ type: 'previous' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!step) return null;
  const solved = step.kind === 'card' && state.solved.includes(step.card.id);

  return (
    <main
      lang={gift.locale}
      className="bg-night text-paper relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden select-none"
    >
      {/* Progress: one segment per step */}
      <div
        className="relative z-30 flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
        aria-hidden
      >
        {steps.map((_, index) => (
          <span key={index} className="bg-paper/25 h-[3px] flex-1 overflow-hidden rounded-full">
            <span
              className={`bg-paper block h-full transition-[width] duration-300 ${index <= state.index ? 'w-full' : 'w-0'}`}
            />
          </span>
        ))}
      </div>

      {/* Tap zones: left third goes back, the rest goes forward */}
      {step.kind !== 'reveal' && (
        <>
          <button
            type="button"
            aria-label={labels.previous}
            disabled={state.index === 0}
            onClick={() => dispatch({ type: 'previous' })}
            className="absolute inset-y-0 left-0 z-10 w-1/3"
          />
          <button
            type="button"
            aria-label={labels.next}
            disabled={!advance}
            onClick={() => dispatch({ type: 'next' })}
            className="absolute inset-y-0 right-0 z-10 w-2/3"
          />
        </>
      )}

      <AnimatePresence mode="wait">
        <motion.section
          key={state.index}
          className="flex flex-1 flex-col items-center justify-center px-6 pb-10"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          {step.kind === 'cover' && (
            <div className="text-center">
              <p className="text-gold text-sm font-semibold tracking-[0.2em] uppercase">
                {labels.coverEyebrow}
              </p>
              <h1 className="font-display mt-4 text-5xl leading-[1.02] tracking-tight text-balance">
                {labels.coverFor}
              </h1>
              {labels.coverFrom && <p className="text-paper/70 mt-4 text-lg">{labels.coverFrom}</p>}
              <motion.p
                className="text-paper/80 mt-14 text-sm font-semibold"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {labels.coverStart}
              </motion.p>
            </div>
          )}

          {step.kind === 'card' && step.card.type === 'PHOTO_TEXT' && (
            <PhotoTextCard payload={step.card.payload} />
          )}
          {step.kind === 'card' && step.card.type === 'AUDIO_NOTE' && (
            <AudioNoteCard
              payload={step.card.payload}
              labels={{ play: labels.play, pause: labels.pause }}
            />
          )}
          {step.kind === 'card' && step.card.type === 'TRIVIA' && (
            <>
              <TriviaCard
                payload={step.card.payload}
                solved={solved}
                onSolved={() =>
                  dispatch({ type: 'solve', cardId: (step.card as { id: string }).id })
                }
                labels={{ wrong: labels.triviaWrong, right: labels.triviaRight }}
              />
              {solved && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'next' })}
                  className="bg-paper text-ink relative z-20 mt-6 rounded-full px-7 py-3 text-sm font-semibold"
                >
                  {labels.continue} →
                </button>
              )}
            </>
          )}

          {step.kind === 'reveal' && (
            <div className="flex w-full flex-col items-center">
              <Reveal
                reveal={gift.reveal}
                labels={labels.reveal}
                recipientName={gift.recipientName}
                onRevealed={() => setRevealed(true)}
              />
              {revealed && (
                <motion.div
                  className="mt-8 flex flex-col items-center gap-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.2 }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(false);
                      dispatch({ type: 'restart' });
                    }}
                    className="text-paper/70 text-sm underline underline-offset-4"
                  >
                    {labels.replay}
                  </button>
                  {gift.watermark && (
                    <Link href="/" className="text-paper/50 text-xs" data-testid="watermark">
                      {labels.watermark}
                    </Link>
                  )}
                </motion.div>
              )}
            </div>
          )}
        </motion.section>
      </AnimatePresence>
    </main>
  );
}
