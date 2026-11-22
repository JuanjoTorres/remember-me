'use client';

import type { GiftEditorView, PremiumRequiredDetails } from '@remember-me/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  type CreatorIntent,
  type UpgradeReason,
  upgradeReasonFor,
} from '@/features/checkout/upgrade-triggers';
import { isApiError } from '@/features/shared/api/client';
import { type GiftApi, giftApi } from './api';

type GiftAction = (api: GiftApi) => Promise<GiftEditorView>;

/** Loads one gift for editing and applies changes; every change answers with the updated gift. */
export function useGiftEditor(giftId: string, editToken: string) {
  const api = useMemo(() => giftApi(giftId, editToken), [giftId, editToken]);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['gift', giftId] as const, [giftId]);
  const query = useQuery({ queryKey, queryFn: api.get });
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason | null>(null);
  const [failed, setFailed] = useState(false);

  const mutation = useMutation({
    mutationFn: (action: GiftAction) => action(api),
    onMutate: () => setFailed(false),
    onSuccess: (gift) => queryClient.setQueryData(queryKey, gift),
    onError: (error) => {
      // The server has the last word on plan limits: its refusal opens the same upgrade sheet.
      if (isApiError(error, 'PREMIUM_REQUIRED')) {
        setUpgradeReason(
          (error.details as PremiumRequiredDetails | undefined)?.capability ?? 'MAX_CARDS',
        );
      } else {
        setFailed(true);
      }
    },
  });

  /** Applies a change. Resolves to the updated gift, or null if it was refused or failed. */
  const run = useCallback(
    (action: GiftAction): Promise<GiftEditorView | null> =>
      mutation.mutateAsync(action).catch(() => null),
    [mutation],
  );

  /** Opens the upgrade sheet instead of running `action` when the plan does not allow the intent. */
  const attempt = useCallback(
    (intent: CreatorIntent, action: () => void): void => {
      const reason = query.data ? upgradeReasonFor(query.data, intent) : null;
      if (reason) setUpgradeReason(reason);
      else action();
    },
    [query.data],
  );

  /** Runs a media, QR or payment call with the gift's grant; refreshes an expired grant once. */
  const withGrant = useCallback(
    async <T>(call: (grant: string) => Promise<T>): Promise<T> => {
      const current = queryClient.getQueryData<GiftEditorView>(queryKey) ?? (await api.get());
      try {
        return await call(current.grant);
      } catch (error) {
        if (!isApiError(error, 'UNAUTHORIZED')) throw error;
        const fresh = await api.get();
        queryClient.setQueryData(queryKey, fresh);
        return call(fresh.grant);
      }
    },
    [api, queryClient, queryKey],
  );

  return {
    api,
    gift: query.data,
    loadError: query.error,
    loading: query.isPending,
    saving: mutation.isPending,
    failed,
    run,
    attempt,
    withGrant,
    upgradeReason,
    openUpgrade: setUpgradeReason,
    closeUpgrade: useCallback(() => setUpgradeReason(null), []),
  };
}
export type GiftEditor = ReturnType<typeof useGiftEditor>;
