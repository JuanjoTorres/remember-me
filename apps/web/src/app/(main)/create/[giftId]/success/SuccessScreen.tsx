'use client';

import type { GiftEditorView } from '@remember-me/shared-types';
import { useCallback, useMemo, useRef, useState } from 'react';
import { confirmPayment } from '@/features/checkout/api';
import { PaymentSuccess } from '@/features/checkout/PaymentSuccess';
import { giftApi } from '@/features/gift-creator/api';
import { EditorGate } from '@/features/gift-creator/components/EditorGate';
import { SharePanel } from '@/features/gift-creator/components/SharePanel';

const CONFIRM_EVERY_POLLS = 5;

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
  const polls = useRef(0);
  const loadGift = useCallback(async () => {
    const gift = await api.get();
    if (gift.plan === 'PREMIUM') return gift;
    // The webhook normally upgrades the gift within seconds. On arrival, and every few polls after
    // that, the payment is also checked with Stripe directly, in case the webhook is late or lost.
    polls.current += 1;
    if (polls.current % CONFIRM_EVERY_POLLS !== 1) return gift;
    const confirmation = await confirmPayment(gift.grant).catch(() => null);
    return confirmation?.status === 'PAID' ? api.get() : gift;
  }, [api]);

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
            } catch {
              // Refused or unreachable: the panel says so and the creator can try again.
              return false;
            }
          }}
        />
      )}
    </PaymentSuccess>
  );
}
