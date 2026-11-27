'use client';

import type { GiftEditorView, Locale, PublicGift } from '@remember-me/shared-types';
import { FREE_GIFT_TTL_YEARS, PLAN_CAPABILITIES } from '@remember-me/shared-types';
import { createTranslator, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { PremiumUpgradeSheet } from '@/features/checkout/PremiumUpgradeSheet';
import { EditorGate } from '@/features/gift-creator/components/EditorGate';
import { useGiftEditor } from '@/features/gift-creator/useGiftEditor';
import { buildExperienceLabels } from '@/features/gift-experience/build-labels';
import { GiftExperience } from '@/features/gift-experience/GiftExperience';
import { BRAND_NAME } from '@/features/shared/brand';
import { Button } from '@/features/shared/ui/Button';
import type { ExperienceMessages } from '@/i18n/experience-messages';

type MessagesByLocale = Record<Locale, ExperienceMessages>;

/** The gift exactly as its recipient will get it, before it has a public link. */
export function toPreviewGift(gift: GiftEditorView): PublicGift {
  return {
    slug: gift.slug,
    locale: gift.locale,
    recipientName: gift.recipientName,
    senderName: gift.senderName,
    cards: gift.cards,
    reveal: gift.reveal,
    // A gift that uses paid features can only be published paid, and a paid gift has no watermark.
    watermark: gift.capabilities.watermark && gift.proFeatures.length === 0,
  };
}

export function PreviewScreen({
  giftId,
  experienceMessages,
}: {
  giftId: string;
  experienceMessages: MessagesByLocale;
}) {
  return (
    <EditorGate giftId={giftId}>
      {(editToken) => (
        <Preview giftId={giftId} editToken={editToken} experienceMessages={experienceMessages} />
      )}
    </EditorGate>
  );
}

function Preview({
  giftId,
  editToken,
  experienceMessages,
}: {
  giftId: string;
  editToken: string;
  experienceMessages: MessagesByLocale;
}) {
  const t = useTranslations('preview');
  const tCreator = useTranslations('creator');
  const tCheckout = useTranslations('checkout');
  const router = useRouter();
  const editor = useGiftEditor(giftId, editToken);
  const { gift } = editor;

  // The recipient reads the gift in the language it was written in, not in the creator's.
  const labels = useMemo(() => {
    if (!gift) return null;
    const translate = createTranslator({
      locale: gift.locale,
      messages: { experience: experienceMessages[gift.locale] },
      namespace: 'experience',
    });
    return buildExperienceLabels((key, values) => translate(key, values), gift);
  }, [gift, experienceMessages]);

  if (editor.loading) {
    return <p className="text-ink-soft py-20 text-center">{tCreator('loading')}</p>;
  }
  if (!gift || !labels) {
    return (
      <div role="alert" className="py-16">
        <h1 className="font-display text-3xl tracking-tight">{tCreator('noAccessTitle')}</h1>
        <p className="text-ink-soft mt-3 leading-relaxed">{tCreator('noAccessText')}</p>
        <Link href="/create" className="mt-6 inline-block underline">
          {tCreator('startNew')}
        </Link>
      </div>
    );
  }

  const published = gift.status === 'PUBLISHED';
  const freeCards = PLAN_CAPABILITIES.FREE.maxCards ?? 0;
  const missing = [
    ...(gift.cards.length === 0 ? [tCreator('missingCards')] : []),
    ...(gift.reveal.headline === '' ? [tCreator('missingHeadline')] : []),
  ];
  const paysToPublish = gift.plan === 'FREE' && gift.proFeatures.length > 0;

  async function publish() {
    // Free gifts are published at once. One that uses paid features is refused by the API, which
    // opens the upgrade sheet; paying publishes it.
    const result = await editor.run((api) => api.publish());
    if (result?.status === 'PUBLISHED') router.replace(`/create/${giftId}/published`);
  }

  const note = published
    ? null
    : missing.length > 0
      ? t('missing', { items: missing.join(' · ') })
      : gift.plan === 'PREMIUM'
        ? t('premiumNote')
        : paysToPublish
          ? t('proNote', {
              features: gift.proFeatures
                .map((feature) => tCheckout(`proFeature.${feature}`, { max: freeCards }))
                .join(' · '),
            })
          : t('freeNote', { brand: BRAND_NAME, years: FREE_GIFT_TTL_YEARS });

  return (
    <div className="bg-night fixed inset-0 z-20 flex flex-col">
      <div
        role="status"
        className="bg-gold text-ink flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 text-xs font-semibold"
      >
        <span>{t(published ? 'bannerPublished' : 'banner')}</span>
        <Link href={`/create/${giftId}`} className="shrink-0 underline underline-offset-2">
          {t('edit')}
        </Link>
      </div>

      <div className="min-h-0 flex-1">
        <GiftExperience embedded gift={toPreviewGift(gift)} labels={labels} />
      </div>

      <div className="bg-paper shrink-0 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md">
          {editor.failed && (
            <p role="alert" className="text-ember-deep mb-2 text-center text-sm">
              {t('publishError')}
            </p>
          )}
          {note && (
            <p
              className="text-ink-soft mb-2 text-center text-xs leading-relaxed"
              data-testid="publish-note"
            >
              {note}
            </p>
          )}
          {published ? (
            <Button block onClick={() => router.push(`/create/${giftId}/published`)}>
              {t('seeQr')}
            </Button>
          ) : (
            <Button block busy={editor.saving} disabled={missing.length > 0} onClick={publish}>
              {t('publish')}
            </Button>
          )}
          {!published && gift.plan === 'FREE' && !paysToPublish && missing.length === 0 && (
            <button
              type="button"
              className="text-ink-soft mt-2 block w-full text-center text-xs underline underline-offset-2"
              onClick={() => editor.openUpgrade('WATERMARK')}
            >
              {t('upgrade')}
            </button>
          )}
        </div>
      </div>

      <PremiumUpgradeSheet
        reason={editor.upgradeReason}
        onClose={editor.closeUpgrade}
        gift={gift}
        withGrant={editor.withGrant}
        cancelPath={`/create/${giftId}/preview`}
      />
    </div>
  );
}
