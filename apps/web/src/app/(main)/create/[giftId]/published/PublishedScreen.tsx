'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { PremiumUpgradeSheet } from '@/features/checkout/PremiumUpgradeSheet';
import { EditorGate } from '@/features/gift-creator/components/EditorGate';
import { SharePanel } from '@/features/gift-creator/components/SharePanel';
import { useGiftEditor } from '@/features/gift-creator/useGiftEditor';
import { formatDateTime, formatDay } from '@/features/shared/format';
import { Button } from '@/features/shared/ui/Button';

/** Where a gift published for free lands: its link and QR code, ready to hand over. */
export function PublishedScreen({ giftId }: { giftId: string }) {
  return (
    <div className="py-12">
      <EditorGate giftId={giftId}>
        {(editToken) => <Published giftId={giftId} editToken={editToken} />}
      </EditorGate>
    </div>
  );
}

function Published({ giftId, editToken }: { giftId: string; editToken: string }) {
  const t = useTranslations('creator');
  const locale = useLocale();
  const editor = useGiftEditor(giftId, editToken);
  const { gift } = editor;

  if (editor.loading) return <p className="text-ink-soft py-20 text-center">{t('loading')}</p>;
  if (!gift) {
    return (
      <div role="alert">
        <h1 className="font-display text-3xl tracking-tight">{t('noAccessTitle')}</h1>
        <p className="text-ink-soft mt-3 leading-relaxed">{t('noAccessText')}</p>
        <Link href="/create" className="mt-6 inline-block underline">
          {t('startNew')}
        </Link>
      </div>
    );
  }
  if (gift.status !== 'PUBLISHED') {
    // Opened by hand before publishing: there is no QR code to show yet.
    return (
      <div>
        <h1 className="font-display text-3xl tracking-tight">{t('title')}</h1>
        <Link href={`/create/${giftId}/preview`} className="mt-6 inline-block underline">
          {t('preview')}
        </Link>
      </div>
    );
  }

  const free = gift.plan === 'FREE';
  return (
    <div>
      <h1 className="font-display text-4xl leading-tight tracking-tight">{t('publishedTitle')}</h1>
      <p className="text-ink-soft mt-3 leading-relaxed">
        {gift.locked || !gift.editableUntil
          ? t('publishedLockedText')
          : t('publishedGraceText', { date: formatDateTime(gift.editableUntil, locale) })}
      </p>
      <div className="mt-8">
        <SharePanel
          gift={gift}
          editToken={editToken}
          withGrant={editor.withGrant}
          onUpgrade={editor.openUpgrade}
          onChangeSlug={async (slug) => (await editor.run((api) => api.changeSlug(slug))) !== null}
        />
      </div>
      {free && (
        <div className="mt-5">
          {gift.expiresAt && (
            <p className="text-ink-soft mb-2 text-center text-sm">
              {t('expiresFreeNote', { date: formatDay(gift.expiresAt, locale) })}
            </p>
          )}
          <Button block variant="secondary" onClick={() => editor.openUpgrade('WATERMARK')}>
            {t('keepForever')}
          </Button>
        </div>
      )}
      <Link
        href={`/create/${giftId}`}
        className="text-ink-soft mt-6 block text-center text-sm underline"
      >
        {t('backToEditor')}
      </Link>
      <PremiumUpgradeSheet
        reason={editor.upgradeReason}
        onClose={editor.closeUpgrade}
        gift={gift}
        withGrant={editor.withGrant}
        cancelPath={`/create/${giftId}/published`}
      />
    </div>
  );
}
