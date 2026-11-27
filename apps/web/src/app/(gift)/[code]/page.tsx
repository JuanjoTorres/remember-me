import type { Metadata } from 'next';
import { GiftPage, giftPageMetadata } from '@/features/gift-experience/GiftPage';

type Props = { params: Promise<{ code: string }> };

/** A generated link: `kardoo.me/x9k2bd7m`. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return giftPageMetadata(await params);
}

export default async function GeneratedLinkPage({ params }: Props) {
  return <GiftPage link={await params} />;
}
