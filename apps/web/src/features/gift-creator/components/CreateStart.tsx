'use client';

import type { Locale } from '@remember-me/shared-types';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/features/shared/ui/Button';
import { createGift } from '../api';
import { savedGiftsSnapshot, saveGift } from '../storage';

const subscribe = () => () => undefined;

/** Entry to the editor: starts a new gift, or offers the ones this device can already edit. */
export function CreateStart() {
  const t = useTranslations('creator');
  const locale = useLocale() as Locale;
  const router = useRouter();
  // `null` while rendering on the server; the device's list once in the browser.
  const saved = useSyncExternalStore(subscribe, savedGiftsSnapshot, () => null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  const started = useRef(false);

  async function start() {
    setCreating(true);
    setError(false);
    try {
      const { gift, editToken } = await createGift(locale);
      saveGift(gift.id, editToken);
      router.replace(`/create/${gift.id}`);
    } catch {
      setError(true);
      setCreating(false);
    }
  }

  useEffect(() => {
    if (started.current || saved === null) return;
    started.current = true;
    // First visit: go straight to a fresh gift instead of showing an empty list.
    if (saved.length === 0) void Promise.resolve().then(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `start` is recreated on every render
  }, [saved]);

  if (saved === null || (saved.length === 0 && !error)) {
    return <p className="text-ink-soft py-20 text-center">{t('creating')}</p>;
  }

  return (
    <div className="py-10">
      <h1 className="font-display text-4xl leading-tight tracking-tight">{t('startTitle')}</h1>
      {saved.length > 0 && (
        <>
          <p className="text-ink-soft mt-2">{t('startText')}</p>
          <ul className="mt-5 space-y-2">
            {saved.map((gift) => (
              <li key={gift.giftId}>
                <Link
                  href={`/create/${gift.giftId}`}
                  className="border-line flex items-center justify-between rounded-2xl border bg-white px-4 py-3.5"
                >
                  <span>
                    {t('savedGift', { date: new Date(gift.savedAt).toLocaleDateString(locale) })}
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-ember-deep mt-4 text-sm">
          {t('createError')}
        </p>
      )}
      <Button block className="mt-6" busy={creating} onClick={start}>
        {t('newGift')}
      </Button>
    </div>
  );
}
