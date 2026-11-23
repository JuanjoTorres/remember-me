import { EditorScreen } from './EditorScreen';

export default async function EditGiftPage({ params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await params;
  return <EditorScreen giftId={giftId} />;
}
