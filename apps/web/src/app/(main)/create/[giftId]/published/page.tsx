import { PublishedScreen } from './PublishedScreen';

export default async function PublishedGiftPage({
  params,
}: {
  params: Promise<{ giftId: string }>;
}) {
  const { giftId } = await params;
  return <PublishedScreen giftId={giftId} />;
}
