import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getPublicGift, REFUSED } from '@/features/gift-experience/get-public-gift';
import { GiftExperience } from '@/features/gift-experience/GiftExperience';
import { experienceLabels } from '@/features/gift-experience/labels';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gift = await getPublicGift((await params).slug);
  // Gifts are private between two people: never indexed, and the link is not leaked as a referrer.
  const privacy = { robots: { index: false, follow: false }, referrer: 'no-referrer' } as const;
  if (!gift || gift === REFUSED) return privacy;
  const t = await getTranslations({ locale: gift.locale, namespace: 'experience' });
  return {
    ...privacy,
    title: gift.recipientName ? t('metaTitle', { name: gift.recipientName }) : t('metaTitleNoName'),
    description: t('metaDescription'),
  };
}

export default async function GiftPage({ params }: Props) {
  const gift = await getPublicGift((await params).slug);
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
