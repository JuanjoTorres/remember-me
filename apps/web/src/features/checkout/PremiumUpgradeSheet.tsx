'use client';

import type { GiftEditorView } from '@remember-me/shared-types';
import { FREE_GIFT_TTL_MONTHS, PLAN_CAPABILITIES } from '@remember-me/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { isApiError } from '@/features/shared/api/client';
import { BRAND_NAME } from '@/features/shared/brand';
import { formatPrice } from '@/features/shared/format';
import { Button } from '@/features/shared/ui/Button';
import { Sheet } from '@/features/shared/ui/Sheet';
import { createCheckoutSession, getPrices } from './api';
import { CustomSlugField, type SlugState } from './CustomSlugField';
import type { UpgradeReason } from './upgrade-triggers';

interface PremiumUpgradeSheetProps {
  /** Why the sheet opened; `null` keeps it closed. */
  reason: UpgradeReason | null;
  onClose: () => void;
  gift: GiftEditorView;
  /** Runs a call with the gift's grant, refreshing the grant once if it expired. */
  withGrant: <T>(call: (grant: string) => Promise<T>) => Promise<T>;
  /** Page Stripe sends the creator back to if they give up. Defaults to the editor. */
  cancelPath?: string;
  /** Where the browser goes for payment. Replaceable in tests. */
  redirect?: (url: string) => void;
}

const FEATURES = [
  'featureForever',
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
  cancelPath,
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
  const [slug, setSlug] = useState('');
  const [slugState, setSlugState] = useState<SlugState>('empty');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const host = new URL(gift.publicUrl).host;
  const price = (amount: number, currency: string) => formatPrice(amount, currency, locale);
  const total = prices.data
    ? prices.data.premium.amount + (includeSlug ? prices.data.customSlug.amount : 0)
    : null;
  const slugBlocksPayment = includeSlug && slugState !== 'valid';

  async function pay() {
    setError(null);
    setPaying(true);
    try {
      // Only the name is sent: the server puts a code in front of it when the payment arrives.
      const customSlug = includeSlug ? slug : undefined;
      const origin = window.location.origin;
      const session = await withGrant((grant) =>
        createCheckoutSession(grant, {
          giftId: gift.id,
          includeCustomSlug: customSlug !== undefined,
          customSlug,
          successUrl: `${origin}/create/${gift.id}/success`,
          cancelUrl: `${origin}${cancelPath ?? `/create/${gift.id}`}`,
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
        <p className="text-ink-soft mt-2 text-[0.95rem] leading-relaxed">
          {t(`reason.${reason}`, { max: PLAN_CAPABILITIES.FREE.maxCards ?? 0, brand: BRAND_NAME })}
        </p>
      )}

      {reason === 'PRO_FEATURES' && gift.proFeatures.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('proUsedLabel')}>
          {gift.proFeatures.map((feature) => (
            <li key={feature} className="bg-gold/25 rounded-full px-2.5 py-1 text-xs font-semibold">
              {t(`proFeature.${feature}`, { max: PLAN_CAPABILITIES.FREE.maxCards ?? 0 })}
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-5 space-y-2.5">
        {FEATURES.map((feature) => (
          <li
            key={feature}
            className={`flex gap-3 text-[0.95rem] ${feature === 'featureForever' ? 'font-semibold' : ''}`}
          >
            <span aria-hidden className="text-ember font-semibold">
              ✓
            </span>
            <span>
              {t(feature)}
              {feature === 'featureForever' && (
                <span className="text-ink-soft block text-sm font-normal">
                  {t('featureForeverHint', { months: FREE_GIFT_TTL_MONTHS })}
                </span>
              )}
            </span>
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
              // Suggests a link from the recipient's name, as it is when the extra is ticked.
              initialName={gift.recipientName}
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
