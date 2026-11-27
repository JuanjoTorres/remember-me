import { EXPERIENCE_MESSAGES } from '@/i18n/experience-messages';
import { PreviewScreen } from './PreviewScreen';

export default async function PreviewGiftPage({ params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await params;
  return <PreviewScreen giftId={giftId} experienceMessages={EXPERIENCE_MESSAGES} />;
}
