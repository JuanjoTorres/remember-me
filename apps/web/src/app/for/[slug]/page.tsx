import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getPublicGift } from '@/features/gift-experience/get-public-gift';
import { GiftExperience } from '@/features/gift-experience/GiftExperience';
import { experienceLabels } from '@/features/gift-experience/labels';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gift = await getPublicGift((await params).slug);
  // Gifts are private between two people: never indexed, and the link is not leaked as a referrer.
  const privacy = { robots: { index: false, follow: false }, referrer: 'no-referrer' } as const;
  if (!gift) return privacy;
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
  return <GiftExperience gift={gift} labels={await experienceLabels(gift)} />;
}
