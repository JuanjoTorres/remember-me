'use client';

import type { GiftEditorView } from '@remember-me/shared-types';
import { useEffect, useState } from 'react';

export type PaymentStatus =
  /** Polling: the webhook has not been processed yet. */
  | 'waiting'
  /** Still polling, but it is taking longer than usual; tell the creator. */
  | 'delayed'
  | 'confirmed'
  /** The gift could not be loaded at all (lost access, deleted). */
  | 'failed';

export interface PaymentStatusOptions {
  intervalMs?: number;
  /** After this long without confirmation the status becomes `delayed` (polling continues). */
  delayedAfterMs?: number;
}

/**
 * After Stripe sends the customer back, the payment is only real once our webhook has run. This
 * polls the gift until it is premium.
 */
export function useGiftPaymentStatus(
  loadGift: () => Promise<GiftEditorView>,
  { intervalMs = 2000, delayedAfterMs = 30_000 }: PaymentStatusOptions = {},
): { status: PaymentStatus; gift: GiftEditorView | null } {
  const [state, setState] = useState<{ status: PaymentStatus; gift: GiftEditorView | null }>({
    status: 'waiting',
    gift: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let failures = 0;

    const poll = async () => {
      try {
        const gift = await loadGift();
        if (cancelled) return;
        failures = 0;
        if (gift.plan === 'PREMIUM') {
          setState({ status: 'confirmed', gift });
          return;
        }
        setState({
          status: Date.now() - startedAt >= delayedAfterMs ? 'delayed' : 'waiting',
          gift,
        });
      } catch {
        if (cancelled) return;
        failures += 1;
        // One failed request can be a network blip; several in a row is a real problem.
        if (failures >= 3) {
          setState((previous) => ({ ...previous, status: 'failed' }));
          return;
        }
      }
      timer = setTimeout(poll, intervalMs);
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadGift, intervalMs, delayedAfterMs]);

  return state;
}
