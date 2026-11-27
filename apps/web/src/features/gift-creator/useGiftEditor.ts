'use client';

import type {
  GiftEditorView,
  GiftLockedDetails,
  PremiumRequiredDetails,
} from '@remember-me/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CreatorIntent,
  type UpgradeReason,
  upgradeReasonFor,
} from '@/features/checkout/upgrade-triggers';
import { isApiError } from '@/features/shared/api/client';
import { type GiftApi, giftApi } from './api';

type GiftAction = (api: GiftApi) => Promise<GiftEditorView>;
/** How a change ended: saved, refused by a rule (plan or lock), or failed. */
interface ChangeOutcome {
  result: 'saved' | 'refused' | 'failed';
  fromField: boolean;
}
/** Saves a text field if it shows a text that is not saved; tells whether it sent a change. */
export type FieldSaver = () => boolean;
/** How often `settled` lets the fields save again before it gives up on a creator who keeps typing. */
const MAX_FIELD_ROUNDS = 5;

/** Loads one gift for editing and applies changes; every change answers with the updated gift. */
export function useGiftEditor(giftId: string, editToken: string) {
  const api = useMemo(() => giftApi(giftId, editToken), [giftId, editToken]);
  const queryClient = useQueryClient();
  // The token is part of the key: switching to another token (a refused link falling back to the
  // stored one) loads the gift again instead of keeping the earlier error.
  const queryKey = useMemo(() => ['gift', giftId, editToken] as const, [giftId, editToken]);
  const query = useQuery({ queryKey, queryFn: api.get });
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason | null>(null);
  const [failed, setFailed] = useState(false);
  // What the server refused to change because the gift was already delivered.
  const [lockedScope, setLockedScope] = useState<GiftLockedDetails['scope'] | null>(null);

  const mutation = useMutation({
    mutationFn: (action: GiftAction) => action(api),
    // One change at a time per gift: responses can never arrive out of order and overwrite newer state.
    scope: { id: `gift-${giftId}` },
    onMutate: () => {
      setFailed(false);
      setLockedScope(null);
    },
    onSuccess: (gift) => queryClient.setQueryData(queryKey, gift),
    onError: (error) => {
      // The server has the last word on plan limits: its refusal opens the same upgrade sheet.
      if (isApiError(error, 'PREMIUM_REQUIRED')) {
        setUpgradeReason(
          (error.details as PremiumRequiredDetails | undefined)?.capability ?? 'MAX_CARDS',
        );
      } else if (isApiError(error, 'GIFT_LOCKED')) {
        setLockedScope((error.details as GiftLockedDetails | undefined)?.scope ?? 'GIFT');
        // The correction window may have ended while the editor was open: show the gift as it is.
        void queryClient.invalidateQueries({ queryKey });
      } else {
        setFailed(true);
      }
    },
  });

  // The changes not answered yet, each with how it ends.
  const pending = useRef(new Set<Promise<ChangeOutcome>>());
  // One per text field on screen: saves the field if it shows a text that is not saved.
  const fields = useRef(new Set<FieldSaver>());
  // The gift the editor was last rendered with, and who waits for the next render.
  const rendered = useRef(query.data);
  const nextRender = useRef<(() => void)[]>([]);
  useEffect(() => {
    rendered.current = query.data;
    for (const resume of nextRender.current.splice(0)) resume();
  });

  /**
   * Applies a change. Resolves to the updated gift, or null if it was refused or failed.
   * `fromField` marks the change of a text field, which `settled` sends again while the field
   * still shows it.
   */
  const run = useCallback(
    (action: GiftAction, fromField = false): Promise<GiftEditorView | null> => {
      const change = mutation.mutateAsync(action);
      const outcome = change.then(
        (): ChangeOutcome => ({ result: 'saved', fromField }),
        (error: unknown): ChangeOutcome => ({
          result:
            isApiError(error, 'PREMIUM_REQUIRED') || isApiError(error, 'GIFT_LOCKED')
              ? 'refused'
              : 'failed',
          fromField,
        }),
      );
      pending.current.add(outcome);
      void outcome.then(() => pending.current.delete(outcome));
      return change.catch(() => null);
    },
    [mutation],
  );

  /**
   * Lets a text field take part in `settled`: `saveIfChanged` saves the field when it shows a
   * text that is not the saved one, and tells whether it did. Returns the function that takes
   * the field out again.
   */
  const registerField = useCallback((saveIfChanged: FieldSaver): (() => void) => {
    fields.current.add(saveIfChanged);
    return () => void fields.current.delete(saveIfChanged);
  }, []);

  /**
   * Tells whether the gift on the server is what the editor shows. It waits until no change is on
   * its way (also one started during the wait) and the editor shows the last answer, then has
   * every text field save its text if that is not the saved one (a field still being typed in,
   * one whose save failed, one typed back while its save was on its way), and so on until no
   * field has anything left to save. A button that leaves the page awaits this and stays on
   * `false`, so the next screen never shows or publishes a gift without the last change. When a
   * change failed the save error stays on screen.
   */
  const settled = useCallback(async (): Promise<boolean> => {
    /** Every change answered, and the answers on screen: only then do the fields know what is saved. */
    const answered = async (): Promise<ChangeOutcome[]> => {
      const outcomes: ChangeOutcome[] = [];
      while (pending.current.size > 0) outcomes.push(...(await Promise.all(pending.current)));
      while (rendered.current !== queryClient.getQueryData(queryKey)) {
        await new Promise<void>((resume) => nextRender.current.push(resume));
      }
      return pending.current.size > 0 ? [...outcomes, ...(await answered())] : outcomes;
    };
    // What happened to a field change sent earlier does not count by itself: below, each field
    // says whether what it shows now is saved.
    const outcomes = (await answered()).filter((outcome) => !outcome.fromField);
    let inSync = false;
    for (let round = 0; round < MAX_FIELD_ROUNDS && !inSync; round += 1) {
      const sent = [...fields.current].filter((saveIfChanged) => saveIfChanged());
      if (sent.length === 0) {
        inSync = true;
        break;
      }
      const answers = await answered();
      outcomes.push(...answers);
      if (answers.some((outcome) => outcome.result !== 'saved')) break;
    }
    // A later change that went well cleared the notice of an earlier one that did not.
    if (outcomes.some((outcome) => outcome.result === 'failed')) setFailed(true);
    return inSync && outcomes.every((outcome) => outcome.result === 'saved');
  }, [queryClient, queryKey]);

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
    lockedScope,
    run,
    registerField,
    settled,
    attempt,
    withGrant,
    upgradeReason,
    openUpgrade: setUpgradeReason,
    closeUpgrade: useCallback(() => setUpgradeReason(null), []),
  };
}
export type GiftEditor = ReturnType<typeof useGiftEditor>;
