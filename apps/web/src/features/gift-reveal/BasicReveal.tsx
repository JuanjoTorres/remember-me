'use client';

import { motion } from 'framer-motion';
import type { RevealProps } from './Reveal';
import { RevealContent } from './RevealContent';

/** Free template: a sealed envelope that opens with a tap. */
export function BasicReveal({ reveal, revealed, onReveal, labels }: RevealProps) {
  if (revealed) {
    return (
      <motion.div
        className="bg-paper text-ink w-full rounded-3xl p-6 shadow-2xl"
        initial={{ opacity: 0, y: 40, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 18, stiffness: 180 }}
      >
        <RevealContent reveal={reveal} />
      </motion.div>
    );
  }
  return (
    <motion.button
      type="button"
      onClick={onReveal}
      className="bg-paper text-ink relative block aspect-[3/2] w-full overflow-hidden rounded-2xl shadow-2xl"
      whileTap={{ scale: 0.97 }}
      animate={{ rotate: [0, -1.5, 1.5, 0] }}
      transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }}
    >
      {/* Envelope flap */}
      <span
        aria-hidden
        className="bg-paper-deep absolute inset-x-0 top-0 h-1/2 [clip-path:polygon(0_0,100%_0,50%_100%)]"
      />
      <span
        aria-hidden
        className="bg-ember absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-md"
      />
      <span className="absolute inset-x-0 bottom-5 text-sm font-semibold">{labels.BASIC}</span>
    </motion.button>
  );
}
