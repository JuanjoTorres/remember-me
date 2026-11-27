'use client';

import type { Card, CardType } from '@remember-me/shared-types';
import { EDIT_GRACE_HOURS, PLAN_CAPABILITIES } from '@remember-me/shared-types';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { PremiumUpgradeSheet } from '@/features/checkout/PremiumUpgradeSheet';
import { isApiError } from '@/features/shared/api/client';
import { formatDateTime, formatDay } from '@/features/shared/format';
import { Button } from '@/features/shared/ui/Button';
import { BrandMark } from '@/features/shared/ui/BrandMark';
import { Field } from '@/features/shared/ui/Field';
import { dropHeldToken, forgetGift, hasStoredToken, saveGift } from '../storage';
import { useGiftEditor } from '../useGiftEditor';
import { CardList } from './CardList';
import { DangerZone } from './DangerZone';
import { type CardDraft, CardSheet } from './CardSheet';
import { RevealSection } from './RevealSection';
import { SavedInput } from './SavedInput';
import { SharePanel } from './SharePanel';

const CARD_TYPES: CardType[] = ['PHOTO_TEXT', 'AUDIO_NOTE', 'TRIVIA'];

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line border-t pt-7">
      <p className="text-ember font-display text-lg tabular-nums">{step}</p>
      <h2 className="font-display text-2xl leading-tight tracking-tight">{title}</h2>
      {hint && <p className="text-ink-soft mt-1 text-sm leading-relaxed">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** The whole editor for one gift: story, surprise, publication and upgrade. */
export function GiftEditor({ giftId, editToken }: { giftId: string; editToken: string }) {
  const t = useTranslations('creator');
  const tCheckout = useTranslations('checkout');
  const locale = useLocale();
  const router = useRouter();
  const editor = useGiftEditor(giftId, editToken);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [openingPreview, setOpeningPreview] = useState(false);
  const { gift } = editor;
  const refused = isApiError(editor.loadError, 'UNAUTHORIZED');

  useEffect(() => {
    // The API accepted the token: now it is safe to remember it on this device.
    if (gift) saveGift(giftId, editToken);
    // The API refused a token that came from a link: go back to the stored one, if any.
    else if (refused && hasStoredToken(giftId)) dropHeldToken(giftId);
  }, [gift, refused, giftId, editToken]);

  if (editor.loading) {
    return <p className="text-ink-soft py-20 text-center">{t('loading')}</p>;
  }
  if (!gift) {
    const lost =
      isApiError(editor.loadError, 'UNAUTHORIZED') || isApiError(editor.loadError, 'NOT_FOUND');
    return (
      <div role="alert" className="py-16">
        <h1 className="font-display text-3xl tracking-tight">
          {t(lost ? 'noAccessTitle' : 'loadErrorTitle')}
        </h1>
        <p className="text-ink-soft mt-3 leading-relaxed">
          {t(lost ? 'noAccessText' : 'loadErrorText')}
        </p>
        <Link href="/create" className="mt-6 inline-block underline">
          {t('startNew')}
        </Link>
      </div>
    );
  }

  const published = gift.status === 'PUBLISHED';
  const free = gift.plan === 'FREE';
  const missing = [
    ...(gift.cards.length === 0 ? [t('missingCards')] : []),
    ...(gift.reveal.headline === '' ? [t('missingHeadline')] : []),
  ];
  const freeCards = PLAN_CAPABILITIES.FREE.maxCards ?? 0;
  // Deadlines are shown on the creator's own clock: the gift is loaded in the browser.
  const date = (iso: string) => formatDateTime(iso, locale);
  const day = (iso: string) => formatDay(iso, locale);
  // Paid features the draft uses: free to try, paid once when it is published.
  const proUsed = free ? gift.proFeatures : [];

  const sharePanel = (
    <SharePanel
      gift={gift}
      editToken={editToken}
      withGrant={editor.withGrant}
      onUpgrade={editor.openUpgrade}
      onChangeSlug={async (slug) => (await editor.run((api) => api.changeSlug(slug))) !== null}
    />
  );

  async function remove(): Promise<boolean> {
    try {
      await editor.api.remove();
    } catch {
      return false;
    }
    forgetGift(giftId);
    router.push('/');
    return true;
  }

  const notice = editor.lockedScope
    ? editor.lockedScope === 'RECIPIENT_NAME'
      ? t('recipientLockedError')
      : t('lockedError', { hours: EDIT_GRACE_HOURS })
    : editor.failed
      ? t('saveError')
      : null;

  return (
    <div className="space-y-8 pb-40">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-tight">
          <BrandMark />
        </Link>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${free ? 'bg-paper-deep text-ink-soft' : 'bg-gold/30 text-ink'}`}
        >
          {t(free ? 'planFree' : 'planPremium')}
        </span>
      </header>

      {published && (
        <div>
          <h1 className="font-display text-3xl leading-tight tracking-tight">
            {t('publishedTitle')}
          </h1>
          <p className="text-ink-soft mt-2 mb-5 leading-relaxed" data-testid="edit-window">
            {gift.locked || !gift.editableUntil
              ? t('publishedLockedText')
              : t('publishedGraceText', { date: date(gift.editableUntil) })}
          </p>
          {sharePanel}
          {free && (
            <div className="mt-5">
              {gift.expiresAt && (
                <p className="text-ink-soft mb-2 text-center text-sm">
                  {t('expiresFreeNote', { date: day(gift.expiresAt) })}
                </p>
              )}
              <Button block variant="secondary" onClick={() => editor.openUpgrade('WATERMARK')}>
                {t('keepForever')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!published && (
        <div>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight">{t('title')}</h1>
          <p className="text-ink-soft mt-2 leading-relaxed">{t('subtitle')}</p>
          {free && gift.expiresAt && (
            <p className="text-ink-soft mt-2 text-sm leading-relaxed">
              {t('draftNote', { date: day(gift.expiresAt) })}
            </p>
          )}
        </div>
      )}

      {/* A delivered gift is read-only: one switch turns every control of the story off. */}
      <fieldset disabled={gift.locked} className="min-w-0 space-y-8 disabled:opacity-60">
        <Section step="1" title={t('namesTitle')}>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('recipientName')}
              hint={published && !gift.locked ? t('recipientLockedHint') : undefined}
            >
              <SavedInput
                value={gift.recipientName}
                maxLength={40}
                placeholder={t('recipientPlaceholder')}
                // The gift was made for this person: the name is fixed once it is published.
                disabled={published}
                register={editor.registerField}
                onSave={(recipientName) =>
                  void editor.run((api) => api.update({ recipientName }), true)
                }
              />
            </Field>
            <Field label={t('senderName')}>
              <SavedInput
                value={gift.senderName}
                maxLength={40}
                placeholder={t('senderPlaceholder')}
                register={editor.registerField}
                onSave={(senderName) => void editor.run((api) => api.update({ senderName }), true)}
              />
            </Field>
          </div>
        </Section>

        <Section
          step="2"
          title={t('storyTitle')}
          hint={
            free
              ? t('storyHintFree', { count: gift.cards.length, max: freeCards })
              : t('storyHintPremium')
          }
        >
          <CardList
            cards={gift.cards}
            editor={editor}
            onEdit={(card: Card) => setDraft({ type: card.type, card })}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {CARD_TYPES.map((cardType) => {
              // Marks what the free plan does not include; nothing is blocked while editing.
              const pro =
                free &&
                (!gift.capabilities.cardTypes.includes(cardType) || gift.cards.length >= freeCards);
              return (
                <Button
                  key={cardType}
                  variant="secondary"
                  className="min-h-11 px-4 text-sm"
                  onClick={() =>
                    editor.attempt({ kind: 'ADD_CARD', cardType }, () =>
                      setDraft({ type: cardType }),
                    )
                  }
                >
                  + {t(`cardType.${cardType}`)}
                  {pro && (
                    <span className="bg-gold/25 rounded-full px-2 py-0.5 text-[0.65rem]">
                      {t('premiumBadge')}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </Section>

        <Section step="3" title={t('revealTitle')} hint={t('revealHint')}>
          <RevealSection gift={gift} editor={editor} />
        </Section>
      </fieldset>

      {/* A draft has no QR yet, but its private edit link must be saved from the start. */}
      {!published && sharePanel}

      {published && (
        <Link
          href={`/create/${giftId}/preview`}
          className="text-ink-soft block text-center text-sm underline underline-offset-4"
        >
          {t('previewAgain')}
        </Link>
      )}

      <DangerZone onDelete={remove} />

      {(notice || !published) && (
        <div className="border-line bg-paper/95 fixed inset-x-0 bottom-0 z-30 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-md">
            {notice && (
              <p role="alert" className="text-ember-deep mb-2 text-center text-sm">
                {notice}
              </p>
            )}
            {!published && (
              <>
                {proUsed.length > 0 && (
                  <p
                    className="text-ink-soft mb-2 text-center text-xs leading-relaxed"
                    data-testid="pro-summary"
                  >
                    <span className="bg-gold/25 text-ink mr-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
                      {t('premiumBadge')}
                    </span>
                    {t('proSummary', {
                      features: proUsed
                        .map((feature) => tCheckout(`proFeature.${feature}`, { max: freeCards }))
                        .join(' · '),
                    })}
                    <span className="block">{t('proSummaryNote')}</span>
                  </p>
                )}
                {missing.length > 0 && (
                  <p className="text-ink-soft mb-2 text-center text-sm">
                    {t('missing', { items: missing.join(' · ') })}
                  </p>
                )}
                <Button
                  block
                  disabled={missing.length > 0}
                  busy={openingPreview}
                  onClick={async () => {
                    // A field left a moment ago may still be saving: the preview must show it, and
                    // a change that was not saved must not be left behind (publishing fixes the
                    // recipient's name).
                    setOpeningPreview(true);
                    if (await editor.settled()) router.push(`/create/${giftId}/preview`);
                    else setOpeningPreview(false);
                  }}
                >
                  {t('preview')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <CardSheet draft={draft} editor={editor} onClose={() => setDraft(null)} />
      <PremiumUpgradeSheet
        reason={editor.upgradeReason}
        onClose={editor.closeUpgrade}
        gift={gift}
        withGrant={editor.withGrant}
      />
    </div>
  );
}
