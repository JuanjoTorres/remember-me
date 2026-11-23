'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { RevealProps } from './Reveal';
import { RevealContent } from './RevealContent';

const TAPS_TO_OPEN = 3;

/** A wrapped box that shakes with each tap and bursts open on the third. */
export function GiftBoxReveal({ reveal, revealed, onReveal, labels }: RevealProps) {
  const [taps, setTaps] = useState(0);

  if (revealed) {
    return (
      <motion.div
        className="bg-paper text-ink w-full rounded-3xl p-6 shadow-2xl"
        initial={{ opacity: 0, scale: 0.6, y: 60 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 14, stiffness: 160 }}
      >
        <RevealContent reveal={reveal} />
      </motion.div>
    );
  }

  function tap() {
    const next = taps + 1;
    setTaps(next);
    if (next >= TAPS_TO_OPEN) onReveal();
  }

  return (
    <div className="flex flex-col items-center">
      <motion.button
        type="button"
        onClick={tap}
        aria-label={labels.GIFT_BOX}
        key={taps}
        className="relative block size-48"
        initial={{ rotate: 0 }}
        animate={
          taps === 0
            ? { y: [0, -6, 0] }
            : { rotate: [0, -9, 8, -6, 4, 0], scale: [1, 1 + taps * 0.04, 1] }
        }
        transition={taps === 0 ? { duration: 1.8, repeat: Infinity } : { duration: 0.5 }}
      >
        {/* Lid, body and ribbon */}
        <span
          aria-hidden
          className="bg-ember-deep absolute inset-x-0 top-6 h-10 rounded-lg shadow-lg"
        />
        <span
          aria-hidden
          className="bg-ember absolute inset-x-3 top-16 bottom-0 rounded-b-xl shadow-xl"
        />
        <span
          aria-hidden
          className="bg-gold absolute top-6 bottom-0 left-1/2 w-7 -translate-x-1/2"
        />
        <span
          aria-hidden
          className="border-gold absolute top-0 left-1/2 size-9 -translate-x-full rounded-full border-[6px]"
        />
        <span
          aria-hidden
          className="border-gold absolute top-0 left-1/2 size-9 rounded-full border-[6px]"
        />
      </motion.button>
      <p className="text-paper/80 mt-6 text-sm font-semibold" aria-live="polite">
        {labels.GIFT_BOX}
        {taps > 0 && ` · ${taps}/${TAPS_TO_OPEN}`}
      </p>
    </div>
  );
}
