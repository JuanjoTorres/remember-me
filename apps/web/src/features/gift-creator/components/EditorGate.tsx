'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useSyncExternalStore } from 'react';
import { getEditToken, saveGift, tokenFromHash } from '../storage';

function readToken(giftId: string): string | null {
  const fromLink = tokenFromHash(window.location.hash);
  if (fromLink) {
    // Opened through the private edit link: remember it and take the secret out of the address bar.
    saveGift(giftId, fromLink);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return fromLink;
  }
  return getEditToken(giftId) ?? null;
}

const subscribe = () => () => undefined;

/** Resolves the edit token of a gift on this device and renders the editor UI with it. */
export function EditorGate({
  giftId,
  children,
}: {
  giftId: string;
  children: (editToken: string) => ReactNode;
}) {
  const t = useTranslations('creator');
  // `undefined` while rendering on the server, then the token (or null) in the browser.
  const token = useSyncExternalStore<string | null | undefined>(
    subscribe,
    () => readToken(giftId),
    () => undefined,
  );

  if (token === undefined) return <p className="text-ink-soft py-20 text-center">{t('loading')}</p>;
  if (token === null) {
    return (
      <div role="alert" className="py-16">
        <h1 className="font-display text-3xl tracking-tight">{t('noAccessTitle')}</h1>
        <p className="text-ink-soft mt-3 leading-relaxed">{t('noAccessText')}</p>
        <Link href="/create" className="mt-6 inline-block underline">
          {t('startNew')}
        </Link>
      </div>
    );
  }
  return <>{children(token)}</>;
}
