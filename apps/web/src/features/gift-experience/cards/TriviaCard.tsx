'use client';

import type { TriviaPayload } from '@remember-me/shared-types';
import { motion } from 'framer-motion';
import { useState } from 'react';

interface TriviaCardProps {
  payload: TriviaPayload;
  solved: boolean;
  onSolved: () => void;
  labels: { wrong: string; right: string };
}

/** A question only the recipient can answer. Wrong answers can be retried; the right one unlocks the way. */
export function TriviaCard({ payload, solved, onSolved, labels }: TriviaCardProps) {
  const [wrong, setWrong] = useState<number[]>([]);
  const [shake, setShake] = useState(0);

  function answer(index: number) {
    if (solved) return;
    if (index === payload.correctIndex) return onSolved();
    setWrong((current) => [...current, index]);
    setShake((count) => count + 1);
  }

  return (
    <div className="relative z-20 w-full">
      <p className="font-display text-center text-[1.75rem] leading-tight tracking-tight text-balance">
        {payload.question}
      </p>
      <motion.ul
        key={shake}
        className="mt-7 space-y-2.5"
        animate={shake > 0 ? { x: [0, -10, 9, -6, 3, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        {payload.options.map((option, index) => {
          const isRight = solved && index === payload.correctIndex;
          const isWrong = wrong.includes(index);
          return (
            <li key={index}>
              <button
                type="button"
                disabled={solved || isWrong}
                onClick={() => answer(index)}
                className={`w-full rounded-2xl border px-4 py-3.5 text-left text-base font-medium transition-colors ${
                  isRight
                    ? 'border-gold bg-gold text-ink'
                    : isWrong
                      ? 'border-paper/15 text-paper/35 line-through'
                      : 'border-paper/30 bg-paper/10 active:bg-paper/20'
                }`}
              >
                {option}
              </button>
            </li>
          );
        })}
      </motion.ul>
      <p className="mt-5 min-h-6 text-center text-sm font-semibold" role="status">
        {solved ? payload.successMessage || labels.right : wrong.length > 0 ? labels.wrong : ''}
      </p>
    </div>
  );
}
