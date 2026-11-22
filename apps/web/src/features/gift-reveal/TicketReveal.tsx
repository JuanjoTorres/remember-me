'use client';

import { motion } from 'framer-motion';
import type { RevealProps } from './Reveal';
import { RevealContent } from './RevealContent';

const TEAR_DISTANCE = 90;

/** A boarding pass whose stub is torn off (dragged or tapped) to show the destination. */
export function TicketReveal({ reveal, revealed, onReveal, labels, recipientName }: RevealProps) {
  return (
    <div className="w-full">
      <div className="bg-paper text-ink overflow-hidden rounded-3xl shadow-2xl">
        <div className="bg-ink text-paper flex items-center justify-between px-5 py-3 text-xs font-semibold tracking-[0.2em] uppercase">
          <span>{labels.ticketTitle}</span>
          <span aria-hidden>✈</span>
        </div>
        <div className="px-5 pt-4 pb-5">
          {recipientName && (
            <p className="text-ink-soft text-xs tracking-wide uppercase">
              {labels.ticketPassenger} ·{' '}
              <span className="text-ink font-semibold">{recipientName}</span>
            </p>
          )}
          <div className="mt-3 min-h-28">
            {revealed ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <RevealContent reveal={reveal} />
              </motion.div>
            ) : (
              <p
                className="font-display text-ink/15 text-center text-5xl tracking-widest select-none"
                aria-hidden
              >
                ? ? ?
              </p>
            )}
          </div>
        </div>
        {!revealed && (
          <div className="border-ink/25 relative border-t-2 border-dashed">
            <motion.button
              type="button"
              onClick={onReveal}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.9}
              onDragEnd={(_event, info) => {
                if (Math.abs(info.offset.x) > TEAR_DISTANCE) onReveal();
              }}
              whileTap={{ scale: 0.98 }}
              className="bg-paper-deep flex w-full touch-pan-y items-center justify-center gap-2 px-5 py-4 text-sm font-semibold"
            >
              <span aria-hidden>✂</span>
              {labels.TICKET}
              <span aria-hidden>→</span>
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
