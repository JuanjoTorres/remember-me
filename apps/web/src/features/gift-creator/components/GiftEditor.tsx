'use client';

import type { Card, CardType } from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { PremiumUpgradeSheet } from '@/features/checkout/PremiumUpgradeSheet';
import { isApiError } from '@/features/shared/api/client';
import { Button } from '@/features/shared/ui/Button';
import { Field } from '@/features/shared/ui/Field';
import { forgetGift } from '../storage';
import { useGiftEditor } from '../useGiftEditor';
import { CardList } from './CardList';
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
  const router = useRouter();
  const editor = useGiftEditor(giftId, editToken);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const { gift } = editor;

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
  const limit = gift.capabilities.maxCards;

  async function remove() {
    if (!window.confirm(t('deleteConfirm'))) return;
    try {
      await editor.api.remove();
      forgetGift(giftId);
      router.push('/');
    } catch {
      window.alert(t('saveError'));
    }
  }

  return (
    <div className="space-y-8 pb-32">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-tight">
          remember<span className="text-ember">.me</span>
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
          <p className="text-ink-soft mt-2 mb-5 leading-relaxed">{t('publishedText')}</p>
          <SharePanel
            gift={gift}
            editToken={editToken}
            withGrant={editor.withGrant}
            onUpgrade={editor.openUpgrade}
            onChangeSlug={async (slug) =>
              (await editor.run((api) => api.changeSlug(slug))) !== null
            }
          />
        </div>
      )}

      {!published && (
        <div>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight">{t('title')}</h1>
          <p className="text-ink-soft mt-2 leading-relaxed">{t('subtitle')}</p>
        </div>
      )}

      <Section step="1" title={t('namesTitle')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('recipientName')}>
            <SavedInput
              value={gift.recipientName}
              maxLength={40}
              placeholder={t('recipientPlaceholder')}
              onSave={(recipientName) => void editor.run((api) => api.update({ recipientName }))}
            />
          </Field>
          <Field label={t('senderName')}>
            <SavedInput
              value={gift.senderName}
              maxLength={40}
              placeholder={t('senderPlaceholder')}
              onSave={(senderName) => void editor.run((api) => api.update({ senderName }))}
            />
          </Field>
        </div>
      </Section>

      <Section
        step="2"
        title={t('storyTitle')}
        hint={
          limit === null
            ? t('storyHintPremium')
            : t('storyHintFree', { count: gift.cards.length, max: limit })
        }
      >
        <CardList
          cards={gift.cards}
          editor={editor}
          onEdit={(card: Card) => setDraft({ type: card.type, card })}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {CARD_TYPES.map((cardType) => (
            <Button
              key={cardType}
              variant="secondary"
              className="min-h-11 px-4 text-sm"
              onClick={() =>
                editor.attempt({ kind: 'ADD_CARD', cardType }, () => setDraft({ type: cardType }))
              }
            >
              + {t(`cardType.${cardType}`)}
              {!gift.capabilities.cardTypes.includes(cardType) && (
                <span className="bg-gold/25 rounded-full px-2 py-0.5 text-[0.65rem]">
                  {t('premiumBadge')}
                </span>
              )}
            </Button>
          ))}
        </div>
      </Section>

      <Section step="3" title={t('revealTitle')} hint={t('revealHint')}>
        <RevealSection gift={gift} editor={editor} />
      </Section>

      {free && published && (
        <Button block variant="secondary" onClick={() => editor.openUpgrade('WATERMARK')}>
          {t('removeWatermark')}
        </Button>
      )}

      <div className="text-center">
        <Button variant="danger" className="text-sm" onClick={remove}>
          {t('deleteGift')}
        </Button>
      </div>

      {(editor.failed || !published) && (
        <div className="border-line bg-paper/95 fixed inset-x-0 bottom-0 z-30 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-md">
            {editor.failed && (
              <p role="alert" className="text-ember-deep mb-2 text-center text-sm">
                {t('saveError')}
              </p>
            )}
            {!published && (
              <>
                {missing.length > 0 && (
                  <p className="text-ink-soft mb-2 text-center text-sm">
                    {t('missing', { items: missing.join(' · ') })}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    block
                    variant={free ? 'secondary' : 'primary'}
                    busy={editor.saving}
                    disabled={missing.length > 0}
                    onClick={() => void editor.run((api) => api.publish())}
                  >
                    {t(free ? 'publishFree' : 'publish')}
                  </Button>
                  {free && (
                    <Button
                      block
                      disabled={missing.length > 0}
                      onClick={() => editor.attempt({ kind: 'REMOVE_WATERMARK' }, () => undefined)}
                    >
                      {t('publishNoWatermark')}
                    </Button>
                  )}
                </div>
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
