'use client';

import confetti from 'canvas-confetti';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect } from 'react';
import type { GiftEditorView } from '@remember-me/shared-types';
import { Button } from '@/features/shared/ui/Button';
import { useGiftPaymentStatus } from './useGiftPaymentStatus';

interface PaymentSuccessProps {
  giftId: string;
  loadGift: () => Promise<GiftEditorView>;
  /** Rendered once the payment is confirmed: the share panel with the final QR code. */
  children: (gift: GiftEditorView) => ReactNode;
}

/** Return page from Stripe Checkout: waits for the webhook, then hands over the final QR code. */
export function PaymentSuccess({ giftId, loadGift, children }: PaymentSuccessProps) {
  const t = useTranslations('checkout');
  const load = useCallback(() => loadGift(), [loadGift]);
  const { status, gift } = useGiftPaymentStatus(load);

  useEffect(() => {
    if (status !== 'confirmed') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.3 },
      colors: ['#e8553d', '#e9b44c', '#1d1326'],
    });
  }, [status]);

  if (status === 'confirmed' && gift) {
    return (
      <div>
        <p className="text-ember text-sm font-medium">{t('successEyebrow')}</p>
        <h1 className="font-display mt-2 text-4xl leading-tight tracking-tight">
          {t('successTitle')}
        </h1>
        <p className="text-ink-soft mt-3 leading-relaxed">
          {gift.status === 'PUBLISHED' ? t('successPublished') : t('successDraft')}
        </p>
        <div className="mt-8">{children(gift)}</div>
        <Link
          href={`/create/${giftId}`}
          className="text-ink-soft mt-6 block text-center text-sm underline"
        >
          {t('backToEditor')}
        </Link>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div role="alert">
        <h1 className="font-display text-3xl leading-tight tracking-tight">{t('failedTitle')}</h1>
        <p className="text-ink-soft mt-3 leading-relaxed">{t('failedText')}</p>
        <Button className="mt-6" variant="secondary" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite">
      <span
        aria-hidden
        className="border-ember block size-9 animate-spin rounded-full border-[3px] border-t-transparent"
      />
      <h1 className="font-display mt-6 text-3xl leading-tight tracking-tight">
        {t('waitingTitle')}
      </h1>
      <p className="text-ink-soft mt-3 leading-relaxed">
        {status === 'delayed' ? t('delayedText') : t('waitingText')}
      </p>
    </div>
  );
}
