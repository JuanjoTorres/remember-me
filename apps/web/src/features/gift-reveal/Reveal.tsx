'use client';

import type { Reveal as RevealData, RevealTemplate } from '@remember-me/shared-types';
import confetti from 'canvas-confetti';
import { type ComponentType, useCallback, useState } from 'react';
import { BasicReveal } from './BasicReveal';
import { GiftBoxReveal } from './GiftBoxReveal';
import { ScratchCardReveal } from './ScratchCardReveal';
import { TicketReveal } from './TicketReveal';

/** Texts of the reveal step, resolved by the caller in the gift's language. */
export interface RevealLabels extends Record<RevealTemplate, string> {
  ticketTitle: string;
  ticketPassenger: string;
  /** Accessible shortcut for people who cannot perform the gesture. */
  revealNow: string;
}

export interface RevealProps {
  reveal: RevealData;
  revealed: boolean;
  onReveal: () => void;
  labels: RevealLabels;
  recipientName: string;
}

const TEMPLATES: Record<RevealTemplate, ComponentType<RevealProps>> = {
  BASIC: BasicReveal,
  SCRATCH_CARD: ScratchCardReveal,
  TICKET: TicketReveal,
  GIFT_BOX: GiftBoxReveal,
};

function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e8553d', '#e9b44c', '#fbf6ef'];
  void confetti({ particleCount: 110, spread: 80, origin: { y: 0.55 }, colors });
  setTimeout(
    () => void confetti({ particleCount: 60, spread: 120, origin: { y: 0.4 }, colors }),
    260,
  );
}

interface RevealStepProps {
  reveal: RevealData;
  labels: RevealLabels;
  recipientName: string;
  onRevealed?: () => void;
}

/** The last step of the experience: the interactive surprise, then confetti. */
export function Reveal({ reveal, labels, recipientName, onRevealed }: RevealStepProps) {
  const [revealed, setRevealed] = useState(false);
  const Template = TEMPLATES[reveal.template];

  const onReveal = useCallback(() => {
    if (revealed) return;
    setRevealed(true);
    celebrate();
    onRevealed?.();
  }, [revealed, onRevealed]);

  return (
    <div className="flex w-full flex-col items-center">
      <Template
        reveal={reveal}
        revealed={revealed}
        onReveal={onReveal}
        labels={labels}
        recipientName={recipientName}
      />
      {!revealed && reveal.template !== 'BASIC' && (
        <button
          type="button"
          onClick={onReveal}
          className="text-paper/60 mt-5 text-sm underline underline-offset-4"
        >
          {labels.revealNow}
        </button>
      )}
    </div>
  );
}
