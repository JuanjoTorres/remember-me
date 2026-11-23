'use client';

import { EditorGate } from '@/features/gift-creator/components/EditorGate';
import { GiftEditor } from '@/features/gift-creator/components/GiftEditor';

export function EditorScreen({ giftId }: { giftId: string }) {
  return (
    <EditorGate giftId={giftId}>
      {(editToken) => <GiftEditor giftId={giftId} editToken={editToken} />}
    </EditorGate>
  );
}
