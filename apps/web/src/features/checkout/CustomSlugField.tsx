'use client';

import {
  CUSTOM_CODE_LENGTH,
  CustomNameSchema,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  slugify,
} from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { TextInput } from '@/features/shared/ui/Field';

/** What is known about the name typed for a custom link. */
export type SlugState = 'empty' | 'invalid' | 'valid';

/** Stands in the address for the code that the server draws once the link is paid for. */
const CODE_PLACEHOLDER = '·'.repeat(CUSTOM_CODE_LENGTH);

interface CustomSlugFieldProps {
  /** Host shown in front of the link, e.g. "kardoo.me". */
  host: string;
  /** Name the field starts with, e.g. taken from the recipient. */
  initialName?: string;
  /** Called with the name ("ana-luis") and whether it can be used. */
  onChange: (name: string, state: SlugState) => void;
}

/** Keeps what the creator types in slug form while they type; trailing hyphens are kept for now. */
export function toSlugInput(raw: string): string {
  const trailingHyphen = /[\s-]$/.test(raw) ? '-' : '';
  const slug = slugify(raw);
  return slug === '' ? '' : (slug + trailingHyphen).slice(0, SLUG_MAX_LENGTH);
}

/**
 * Custom link input. The creator chooses the name and nothing else: the code in front of it is
 * drawn by the server when the link is given to the gift, so that nobody picks an easy one and
 * nobody finds a gift by trying names. Any valid name can be had, so there is nothing to check
 * with the server; the address is shown with the code still to come.
 */
export function CustomSlugField({ host, initialName = '', onChange }: CustomSlugFieldProps) {
  const t = useTranslations('checkout');
  const [name, setName] = useState(() => toSlugInput(initialName));
  const candidate = slugify(name);
  const state: SlugState =
    candidate === ''
      ? 'empty'
      : CustomNameSchema.safeParse(candidate).success
        ? 'valid'
        : 'invalid';

  useEffect(() => {
    onChange(candidate, state);
    // `onChange` is a callback from the parent; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, state]);

  const message: Record<SlugState, string> = {
    empty: t('slugHint'),
    invalid: t('slugInvalid', { min: SLUG_MIN_LENGTH, max: SLUG_MAX_LENGTH }),
    valid: t('slugValid'),
  };
  const tone =
    state === 'valid'
      ? 'text-emerald-700'
      : state === 'invalid'
        ? 'text-ember-deep'
        : 'text-ink-soft';

  return (
    <div>
      <label className="block">
        <span className="text-ink-soft mb-1 block text-xs font-medium">{t('slugLabel')}</span>
        <TextInput
          value={name}
          onChange={(event) => setName(toSlugInput(event.target.value))}
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
        <span className="text-ink-soft">
          {host}/{CODE_PLACEHOLDER}/for/
        </span>
        <span className="text-ink font-semibold">{candidate || t('slugPlaceholder')}</span>
      </p>
      <p className={`mt-1.5 text-sm ${tone}`} role="status">
        {message[state]}
      </p>
      <p className="text-ink-soft mt-1 text-xs leading-relaxed">
        {t('slugCodeHint', { length: CUSTOM_CODE_LENGTH })}
      </p>
    </div>
  );
}
