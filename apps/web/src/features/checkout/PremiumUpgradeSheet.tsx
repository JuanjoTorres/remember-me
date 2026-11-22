'use client';

import type { GiftEditorView } from '@remember-me/shared-types';
import { slugify } from '@remember-me/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { isApiError } from '@/features/shared/api/client';
import { formatPrice } from '@/features/shared/format';
import { Button } from '@/features/shared/ui/Button';
import { Sheet } from '@/features/shared/ui/Sheet';
import { createCheckoutSession, getPrices, getSlugAvailability } from './api';
import { CustomSlugField, type SlugState } from './CustomSlugField';
import type { UpgradeReason } from './upgrade-triggers';

interface PremiumUpgradeSheetProps {
  /** Why the sheet opened; `null` keeps it closed. */
  reason: UpgradeReason | null;
  onClose: () => void;
  gift: GiftEditorView;
  /** Runs a call with the gift's grant, refreshing the grant once if it expired. */
  withGrant: <T>(call: (grant: string) => Promise<T>) => Promise<T>;
  /** Where the browser goes for payment. Replaceable in tests. */
  redirect?: (url: string) => void;
}

const FEATURES = [
  'featureCards',
  'featureVoice',
  'featureTrivia',
  'featureReveals',
  'featureWatermark',
  'featureQr',
] as const;

/** Upgrade drawer: what the full experience adds, the optional custom link, and the way to pay. */
export function PremiumUpgradeSheet({
  reason,
  onClose,
  gift,
  withGrant,
  redirect = (url) => window.location.assign(url),
}: PremiumUpgradeSheetProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const open = reason !== null;
  const prices = useQuery({
    queryKey: ['prices'],
    queryFn: getPrices,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const [includeSlug, setIncludeSlug] = useState(false);
  const [slug, setSlug] = useState(() => slugify(gift.recipientName));
  const [slugState, setSlugState] = useState<SlugState>('empty');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const host = new URL(gift.publicUrl).host;
  const price = (amount: number, currency: string) => formatPrice(amount, currency, locale);
  const total = prices.data
    ? prices.data.premium.amount + (includeSlug ? prices.data.customSlug.amount : 0)
    : null;
  const slugBlocksPayment = includeSlug && slugState !== 'available';

  async function pay() {
    setError(null);
    setPaying(true);
    try {
      const customSlug = includeSlug ? slugify(slug) : undefined;
      if (customSlug !== undefined && !(await getSlugAvailability(customSlug)).available) {
        setSlugState('taken');
        return;
      }
      const origin = window.location.origin;
      const session = await withGrant((grant) =>
        createCheckoutSession(grant, {
          giftId: gift.id,
          includeCustomSlug: customSlug !== undefined,
          customSlug,
          successUrl: `${origin}/create/${gift.id}/success`,
          cancelUrl: `${origin}/create/${gift.id}`,
        }),
      );
      redirect(session.checkoutUrl);
    } catch (cause) {
      setError(isApiError(cause, 'CONFLICT') ? t('alreadyPremium') : t('payError'));
    } finally {
      setPaying(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('title')} closeLabel={t('close')}>
      {reason && (
        <p className="text-ink-soft mt-2 text-[0.95rem] leading-relaxed">{t(`reason.${reason}`)}</p>
      )}

      <ul className="mt-5 space-y-2.5">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex gap-3 text-[0.95rem]">
            <span aria-hidden className="text-ember font-semibold">
              ✓
            </span>
            {t(feature)}
          </li>
        ))}
      </ul>

      <div className="border-line mt-6 rounded-2xl border bg-white p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="accent-ember mt-1 size-5 shrink-0"
            checked={includeSlug}
            onChange={(event) => setIncludeSlug(event.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{t('slugTitle')}</span>
              <span className="text-ink-soft shrink-0 text-sm tabular-nums">
                {prices.data
                  ? `+${price(prices.data.customSlug.amount, prices.data.customSlug.currency)}`
                  : '…'}
              </span>
            </span>
            <span className="text-ink-soft mt-0.5 block text-sm">{t('slugSubtitle')}</span>
          </span>
        </label>
        {includeSlug && (
          <div className="mt-4">
            <CustomSlugField
              host={host}
              value={slug}
              onChange={(next, state) => {
                setSlug(next);
                setSlugState(state);
              }}
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-ember-deep mt-4 text-sm">
          {error}
        </p>
      )}
      {prices.isError && (
        <p role="alert" className="text-ember-deep mt-4 text-sm">
          {t('pricesError')}
        </p>
      )}

      <Button
        block
        className="mt-5"
        busy={paying}
        disabled={total === null || slugBlocksPayment}
        onClick={pay}
      >
        {total !== null && prices.data
          ? t('pay', { price: price(total, prices.data.premium.currency) })
          : t('payLoading')}
      </Button>
      <p className="text-ink-soft mt-3 text-center text-sm">{t('payNote')}</p>
    </Sheet>
  );
}
