'use client';

import {
  CUSTOM_CODE_LENGTH,
  customLink,
  CustomSlugSchema,
  randomCode,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  slugify,
} from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { TextInput } from '@/features/shared/ui/Field';
import { checkSlug } from './api';

/** `unchecked`: the availability request failed or was refused; the link can still be paid for. */
export type SlugState = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unchecked';

/** How many other codes are tried, without asking the creator, when a link turns out taken. */
const CODE_RETRIES = 3;

interface CustomSlugFieldProps {
  /** Host shown in front of the slug, e.g. "kardoo.me". */
  host: string;
  /** Name the field starts with, e.g. taken from the recipient. */
  initialName?: string;
  /** Called with the whole link as it is stored ("7k2m/for/ana-luis") and what is known about it. */
  onChange: (slug: string, state: SlugState) => void;
}

/** Keeps what the creator types in slug form while they type; trailing hyphens are kept for now. */
export function toSlugInput(raw: string): string {
  const trailingHyphen = /[\s-]$/.test(raw) ? '-' : '';
  const slug = slugify(raw);
  return slug === '' ? '' : (slug + trailingHyphen).slice(0, SLUG_MAX_LENGTH);
}

/**
 * Custom link input. The creator chooses the name; a short random code goes in front of it, so
 * that nobody finds a gift by trying common names. Shows the final address and checks it; if that
 * exact link is taken, which is rare, another code is drawn without asking.
 */
export function CustomSlugField({ host, initialName = '', onChange }: CustomSlugFieldProps) {
  const t = useTranslations('checkout');
  const [name, setName] = useState(() => toSlugInput(initialName));
  const [code, setCode] = useState(() => randomCode(CUSTOM_CODE_LENGTH));
  const [retries, setRetries] = useState(0);
  const [state, setState] = useState<SlugState>('empty');
  const base = slugify(name);
  const candidate = base === '' ? '' : customLink(code, base);

  useEffect(() => {
    const update = (next: SlugState) => {
      setState(next);
      onChange(candidate, next);
    };
    if (candidate === '') return update('empty');
    if (!CustomSlugSchema.safeParse(candidate).success) return update('invalid');

    update('checking');
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        checkSlug(candidate, controller.signal)
          .then((result) => {
            if (result.available) return update('available');
            // Someone has this very code and name: another code makes the link free again.
            if (result.reason === 'TAKEN' && retries < CODE_RETRIES) {
              setRetries(retries + 1);
              return setCode(randomCode(CUSTOM_CODE_LENGTH));
            }
            update(result.reason === 'TAKEN' ? 'taken' : 'invalid');
          })
          .catch(() => {
            if (!controller.signal.aborted) update('unchecked');
          });
        // Typing waits for a pause; another code after a taken link is tried at once.
      },
      retries > 0 ? 0 : 350,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `onChange` is a callback from the parent; re-running on its identity would loop. `retries`
    // only changes together with the code, which changes `candidate`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

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
        <span className="text-ink-soft mb-1 block text-xs font-medium">{t('slugLabel')}</span>
        <TextInput
          value={name}
          onChange={(event) => {
            setRetries(0);
            setName(toSlugInput(event.target.value));
          }}
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
          {host}/{code}/for/
        </span>
        <span className="text-ink font-semibold">{base || t('slugPlaceholder')}</span>
      </p>
      <p className={`mt-1.5 text-sm ${tone}`} role="status">
        {message[state]}
      </p>
      <p className="text-ink-soft mt-1 text-xs leading-relaxed">{t('slugCodeHint')}</p>
    </div>
  );
}
