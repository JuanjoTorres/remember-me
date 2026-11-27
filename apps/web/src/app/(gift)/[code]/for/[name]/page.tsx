import type { Metadata } from 'next';
import { GiftPage, giftPageMetadata } from '@/features/gift-experience/GiftPage';

type Props = { params: Promise<{ code: string; name: string }> };

/** A custom link: `kardoo.me/7k2m/for/ana-luis`. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return giftPageMetadata(await params);
}

export default async function CustomLinkPage({ params }: Props) {
  return <GiftPage link={await params} />;
}
