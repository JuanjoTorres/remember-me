'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/features/shared/ui/Button';
import { TextInput } from '@/features/shared/ui/Field';

/** Either word confirms, whatever the language of the page: the creator may know only one. */
const CONFIRM_WORDS = ['DELETE', 'BORRAR'];

export function isDeleteConfirmation(typed: string): boolean {
  return CONFIRM_WORDS.includes(typed.trim().toUpperCase());
}

/**
 * Irreversible deletion of the gift and all its files. Two deliberate steps: asking for it, then
 * typing the confirmation word. `onDelete` resolves to false when the deletion failed.
 */
export function DangerZone({ onDelete }: { onDelete: () => Promise<boolean> }) {
  const t = useTranslations('creator');
  const inputId = useId();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setBusy(true);
    setFailed(false);
    if (!(await onDelete())) {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="border-ember-deep/30 rounded-2xl border p-4"
    >
      <h2 id={`${inputId}-title`} className="text-ember-deep font-semibold">
        {t('dangerTitle')}
      </h2>
      <p className="text-ink-soft mt-1 text-sm leading-relaxed">{t('dangerText')}</p>

      {!confirming ? (
        <Button variant="danger" className="mt-2 -ml-5 text-sm" onClick={() => setConfirming(true)}>
          {t('deleteGift')}
        </Button>
      ) : (
        <div className="mt-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t('deleteConfirmLabel', { word: t('deleteWord') })}
          </label>
          <TextInput
            id={inputId}
            className="mt-1.5"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          {failed && (
            <p role="alert" className="text-ember-deep mt-2 text-sm">
              {t('deleteError')}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
                setTyped('');
                setFailed(false);
              }}
            >
              {t('deleteCancel')}
            </Button>
            <Button
              className="bg-ember-deep"
              busy={busy}
              disabled={!isDeleteConfirmation(typed)}
              onClick={remove}
            >
              {t('deleteForever')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
