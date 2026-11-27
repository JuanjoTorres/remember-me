import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getPublicGift, type GiftLink, REFUSED } from './get-public-gift';
import { GiftExperience } from './GiftExperience';
import { experienceLabels } from './labels';

/**
 * Metadata of a gift page, whichever of the two link shapes led to it. Gifts are private between
 * two people: never indexed, and the link is not leaked as a referrer.
 */
export async function giftPageMetadata(link: GiftLink): Promise<Metadata> {
  const gift = await getPublicGift(link);
  const privacy = { robots: { index: false, follow: false }, referrer: 'no-referrer' } as const;
  if (!gift || gift === REFUSED) return privacy;
  const t = await getTranslations({ locale: gift.locale, namespace: 'experience' });
  return {
    ...privacy,
    title: gift.recipientName ? t('metaTitle', { name: gift.recipientName }) : t('metaTitleNoName'),
    description: t('metaDescription'),
  };
}

/** What a gift link opens: the experience, or what there is to say when it cannot be shown. */
export async function GiftPage({ link }: { link: GiftLink }) {
  const gift = await getPublicGift(link);
  if (!gift) notFound();
  if (gift === REFUSED) return <TooManyAttempts />;
  return <GiftExperience gift={gift} labels={await experienceLabels(gift)} />;
}

/**
 * Shown to a visitor the API refuses for a while. It says nothing about the link itself: whether a
 * gift is behind it is exactly what must not be found out by trying.
 */
async function TooManyAttempts() {
  const t = await getTranslations('experience');
  return (
    <main className="text-paper mx-auto flex h-dvh max-w-md flex-col items-center justify-center px-8 text-center">
      <h1 className="font-display text-4xl leading-tight tracking-tight">{t('refusedTitle')}</h1>
      <p className="text-paper/70 mt-4 leading-relaxed">{t('refusedText')}</p>
    </main>
  );
}
