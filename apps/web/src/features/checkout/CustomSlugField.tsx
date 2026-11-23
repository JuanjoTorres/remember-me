'use client';

import {
  CustomSlugSchema,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  slugify,
} from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { TextInput } from '@/features/shared/ui/Field';
import { getSlugAvailability } from './api';

/** `unchecked`: the availability request failed; paying checks again. */
export type SlugState = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unchecked';

interface CustomSlugFieldProps {
  /** Host shown in front of the slug, e.g. "remember.me". */
  host: string;
  value: string;
  onChange: (slug: string, state: SlugState) => void;
}

/** Keeps what the creator types in slug form while they type; trailing hyphens are kept for now. */
export function toSlugInput(raw: string): string {
  const trailingHyphen = /[\s-]$/.test(raw) ? '-' : '';
  const slug = slugify(raw);
  return slug === '' ? '' : (slug + trailingHyphen).slice(0, SLUG_MAX_LENGTH);
}

/** Custom link input with a live preview of the final address and an availability check. */
export function CustomSlugField({ host, value, onChange }: CustomSlugFieldProps) {
  const t = useTranslations('checkout');
  const [state, setState] = useState<SlugState>('empty');
  const candidate = slugify(value);

  useEffect(() => {
    const update = (next: SlugState) => {
      setState(next);
      onChange(value, next);
    };
    if (candidate === '') return update('empty');
    if (!CustomSlugSchema.safeParse(candidate).success) return update('invalid');

    update('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getSlugAvailability(candidate, controller.signal)
        .then((result) => update(result.available ? 'available' : 'taken'))
        .catch(() => {
          if (!controller.signal.aborted) update('unchecked');
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `onChange` is a callback from the parent; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, value]);

  const message: Record<SlugState, string> = {
    empty: t('slugHint'),
    invalid: t('slugInvalid', { min: SLUG_MIN_LENGTH, max: SLUG_MAX_LENGTH }),
    checking: t('slugChecking'),
    available: t('slugAvailable'),
    taken: t('slugTaken'),
    unchecked: t('slugUnchecked'),
  };
  const tone =
    state === 'available'
      ? 'text-emerald-700'
      : state === 'taken' || state === 'invalid'
        ? 'text-ember-deep'
        : 'text-ink-soft';

  return (
    <div>
      <label className="block">
        <span className="sr-only">{t('slugLabel')}</span>
        <TextInput
          value={value}
          onChange={(event) => onChange(toSlugInput(event.target.value), state)}
          placeholder={t('slugPlaceholder')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          maxLength={SLUG_MAX_LENGTH}
        />
      </label>
      <p
        className="bg-paper-deep mt-2 truncate rounded-xl px-3 py-2 font-mono text-sm"
        data-testid="slug-preview"
      >
        <span className="text-ink-soft">{host}/for/</span>
        <span className="text-ink font-semibold">{candidate || t('slugPlaceholder')}</span>
      </p>
      <p className={`mt-1.5 text-sm ${tone}`} role="status">
        {message[state]}
      </p>
    </div>
  );
}
