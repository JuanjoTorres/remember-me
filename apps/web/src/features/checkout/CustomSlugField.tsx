'use client';

import {
  CustomSlugSchema,
  joinSlug,
  randomSlugSuffix,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_SUFFIX_MIN_LENGTH,
  slugify,
  SlugSuffixSchema,
  splitSlug,
} from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { TextInput } from '@/features/shared/ui/Field';
import { checkSlug } from './api';

/** `unchecked`: the availability request failed; paying checks again. */
export type SlugState = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unchecked';

/** Longest ending a creator may type; the name keeps the rest of the link. */
const SUFFIX_MAX_LENGTH = 12;

interface CustomSlugFieldProps {
  /** Host shown in front of the slug, e.g. "kardoo.me". */
  host: string;
  /** Name the field starts with, e.g. taken from the recipient. */
  initialName?: string;
  /** Called with the whole link (name and ending) and what is known about it. */
  onChange: (slug: string, state: SlugState) => void;
}

/** Keeps what the creator types in slug form while they type; trailing hyphens are kept for now. */
export function toSlugInput(raw: string): string {
  const trailingHyphen = /[\s-]$/.test(raw) ? '-' : '';
  const slug = slugify(raw);
  return slug === '' ? '' : (slug + trailingHyphen).slice(0, SLUG_MAX_LENGTH);
}

/** The ending accepts lowercase letters and digits only. */
export function toSuffixInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, SUFFIX_MAX_LENGTH);
}

/**
 * Custom link input: a name the creator chooses plus an ending. The ending starts as a random code
 * and can be replaced by one of their own, but it is always there, so that nobody finds a gift by
 * trying common names. Shows the final address, checks it, and offers alternatives when taken.
 */
export function CustomSlugField({ host, initialName = '', onChange }: CustomSlugFieldProps) {
  const t = useTranslations('checkout');
  const [name, setName] = useState(() => toSlugInput(initialName));
  const [suffix, setSuffix] = useState(randomSlugSuffix);
  const [state, setState] = useState<SlugState>('empty');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const base = slugify(name);
  const candidate = base === '' ? '' : suffix === '' ? base : joinSlug(base, suffix);

  useEffect(() => {
    const update = (next: SlugState, alternatives: string[] = []) => {
      setState(next);
      setSuggestions(alternatives);
      onChange(candidate, next);
    };
    if (candidate === '') return update('empty');
    // The ending is its own field here: a last word of the name must not stand in for it.
    const valid =
      SlugSuffixSchema.safeParse(suffix).success && CustomSlugSchema.safeParse(candidate).success;
    if (!valid) return update('invalid');

    update('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkSlug(candidate, controller.signal)
        .then((result) =>
          result.available ? update('available') : update('taken', result.suggestions ?? []),
        )
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
  }, [candidate]);

  function use(suggestion: string) {
    const parts = splitSlug(suggestion);
    if (!parts) return;
    setName(parts.base);
    setSuffix(parts.suffix);
  }

  const message: Record<SlugState, string> = {
    empty: t('slugHint'),
    invalid: t('slugInvalid', {
      min: SLUG_MIN_LENGTH,
      max: SLUG_MAX_LENGTH,
      suffixMin: SLUG_SUFFIX_MIN_LENGTH,
    }),
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
      <div className="flex items-end gap-2">
        <label className="block min-w-0 flex-1">
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
        <label className="block w-28 shrink-0">
          <span className="text-ink-soft mb-1 block text-xs font-medium">
            {t('slugSuffixLabel')}
          </span>
          <TextInput
            value={suffix}
            onChange={(event) => setSuffix(toSuffixInput(event.target.value))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={SUFFIX_MAX_LENGTH}
            className="font-mono"
          />
        </label>
      </div>
      <button
        type="button"
        className="text-ink-soft mt-1.5 text-xs underline underline-offset-2"
        onClick={() => setSuffix(randomSlugSuffix())}
      >
        {t('slugSuffixShuffle')}
      </button>
      <p
        className="bg-paper-deep mt-2 truncate rounded-xl px-3 py-2 font-mono text-sm"
        data-testid="slug-preview"
      >
        <span className="text-ink-soft">{host}/for/</span>
        <span className="text-ink font-semibold">
          {candidate || `${t('slugPlaceholder')}-${suffix}`}
        </span>
      </p>
      <p className={`mt-1.5 text-sm ${tone}`} role="status">
        {message[state]}
      </p>
      <p className="text-ink-soft mt-1 text-xs leading-relaxed">
        {t('slugSuffixHint', { min: SLUG_SUFFIX_MIN_LENGTH })}
      </p>
      {state === 'taken' && suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-ink-soft text-xs font-medium">{t('slugSuggestions')}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  className="border-line rounded-full border bg-white px-3 py-1.5 font-mono text-xs"
                  onClick={() => use(suggestion)}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
