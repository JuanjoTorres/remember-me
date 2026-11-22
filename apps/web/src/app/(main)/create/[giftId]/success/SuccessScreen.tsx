'use client';

import type { GiftEditorView } from '@remember-me/shared-types';
import { useCallback, useMemo, useState } from 'react';
import { PaymentSuccess } from '@/features/checkout/PaymentSuccess';
import { giftApi } from '@/features/gift-creator/api';
import { EditorGate } from '@/features/gift-creator/components/EditorGate';
import { SharePanel } from '@/features/gift-creator/components/SharePanel';
import { isApiError } from '@/features/shared/api/client';

export function SuccessScreen({ giftId }: { giftId: string }) {
  return (
    <div className="py-12">
      <EditorGate giftId={giftId}>
        {(editToken) => <Confirmed giftId={giftId} editToken={editToken} />}
      </EditorGate>
    </div>
  );
}

function Confirmed({ giftId, editToken }: { giftId: string; editToken: string }) {
  const api = useMemo(() => giftApi(giftId, editToken), [giftId, editToken]);
  // The link can change after confirmation (choosing another custom link); keep the latest view.
  const [latest, setLatest] = useState<GiftEditorView | null>(null);
  const loadGift = useCallback(() => api.get(), [api]);

  const withGrant = useCallback(
    async <T,>(call: (grant: string) => Promise<T>): Promise<T> => {
      const fresh = await api.get();
      setLatest(fresh);
      return call(fresh.grant);
    },
    [api],
  );

  return (
    <PaymentSuccess giftId={giftId} loadGift={loadGift}>
      {(confirmed) => (
        <SharePanel
          gift={latest ?? confirmed}
          editToken={editToken}
          withGrant={withGrant}
          onUpgrade={() => undefined}
          onChangeSlug={async (slug) => {
            try {
              setLatest(await api.changeSlug(slug));
              return true;
            } catch (error) {
              if (isApiError(error)) return false;
              throw error;
            }
          }}
        />
      )}
    </PaymentSuccess>
  );
}
