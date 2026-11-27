'use client';

import type { GiftEditorView, QrFormat } from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { CustomSlugField, type SlugState } from '@/features/checkout/CustomSlugField';
import type { UpgradeReason } from '@/features/checkout/upgrade-triggers';
import { isApiError } from '@/features/shared/api/client';
import { BRAND_NAME } from '@/features/shared/brand';
import { displayUrl } from '@/features/shared/format';
import { Button } from '@/features/shared/ui/Button';
import { downloadQr } from '../api';
import { editLink } from '../storage';

interface SharePanelProps {
  gift: GiftEditorView;
  editToken: string;
  withGrant: <T>(call: (grant: string) => Promise<T>) => Promise<T>;
  onUpgrade: (reason: UpgradeReason) => void;
  /** Applies the paid custom link when the first choice was taken. Resolves to false if refused. */
  onChangeSlug: (slug: string) => Promise<boolean>;
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Everything needed to hand the gift over: the link, the QR code and the private edit link. */
export function SharePanel({
  gift,
  editToken,
  withGrant,
  onUpgrade,
  onChangeSlug,
}: SharePanelProps) {
  const t = useTranslations('creator');
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'edit' | null>(null);
  const [downloading, setDownloading] = useState<QrFormat | null>(null);
  const published = gift.status === 'PUBLISHED';

  useEffect(() => {
    if (!published) return;
    let url: string | undefined;
    let cancelled = false;
    withGrant((grant) => downloadQr(grant, 'png'))
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // The code only changes with the link or the plan (resolution).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published, gift.slug, gift.plan]);

  async function copy(what: 'link' | 'edit', text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  async function download(format: QrFormat) {
    if (!gift.capabilities.qrFormats.includes(format)) return onUpgrade('QR_FORMAT');
    setDownloading(format);
    try {
      saveFile(
        await withGrant((grant) => downloadQr(grant, format)),
        // A custom link has slashes, which a file name cannot have.
        `remember-me-${gift.slug.replaceAll('/', '-')}.${format}`,
      );
    } catch (error) {
      if (isApiError(error, 'PREMIUM_REQUIRED')) onUpgrade('QR_FORMAT');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-5">
      {published && (
        <div className="border-line rounded-3xl border bg-white p-5 text-center">
          <div className="bg-paper-deep mx-auto flex size-44 items-center justify-center overflow-hidden rounded-2xl">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated blob
              <img src={qr} alt={t('qrAlt')} className="size-full" />
            ) : (
              <span
                aria-hidden
                className="border-ember size-6 animate-spin rounded-full border-2 border-t-transparent"
              />
            )}
          </div>
          <a
            href={gift.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block font-mono text-sm break-all underline"
          >
            {displayUrl(gift.publicUrl)}
          </a>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => copy('link', gift.publicUrl)}>
              {copied === 'link' ? t('copied') : t('copyLink')}
            </Button>
            <Button busy={downloading === 'png'} onClick={() => download('png')}>
              {t('downloadPng')}
            </Button>
            <Button
              variant="secondary"
              busy={downloading === 'svg'}
              onClick={() => download('svg')}
            >
              {t('downloadSvg')}
              {!gift.capabilities.qrFormats.includes('svg') && (
                <span className="bg-gold/25 rounded-full px-2 py-0.5 text-[0.65rem]">
                  {t('premiumBadge')}
                </span>
              )}
            </Button>
          </div>
          {gift.capabilities.watermark && (
            <p className="text-ink-soft mt-3 text-sm">
              {t('watermarkNote', { brand: BRAND_NAME })}
            </p>
          )}
        </div>
      )}

      {gift.customSlugPending && <PendingSlug gift={gift} onChangeSlug={onChangeSlug} />}

      <div className="bg-paper-deep rounded-2xl p-4">
        <h3 className="font-semibold">{t('editLinkTitle')}</h3>
        <p className="text-ink-soft mt-1 text-sm leading-relaxed">{t('editLinkText')}</p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => copy('edit', editLink(window.location.origin, gift.id, editToken))}
        >
          {copied === 'edit' ? t('copied') : t('copyEditLink')}
        </Button>
      </div>
    </div>
  );
}

function PendingSlug({ gift, onChangeSlug }: Pick<SharePanelProps, 'gift' | 'onChangeSlug'>) {
  const t = useTranslations('creator');
  const [slug, setSlug] = useState('');
  const [state, setState] = useState<SlugState>('empty');
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-gold rounded-2xl border bg-white p-4">
      <h3 className="font-semibold">{t('pendingSlugTitle')}</h3>
      <p className="text-ink-soft mt-1 mb-3 text-sm leading-relaxed">{t('pendingSlugText')}</p>
      <CustomSlugField
        host={new URL(gift.publicUrl).host}
        onChange={(next, nextState) => {
          setSlug(next);
          setState(nextState);
        }}
      />
      <Button
        className="mt-3"
        busy={busy}
        disabled={state !== 'available'}
        onClick={async () => {
          setBusy(true);
          if (!(await onChangeSlug(slug))) setState('taken');
          setBusy(false);
        }}
      >
        {t('pendingSlugSave')}
      </Button>
    </div>
  );
}
