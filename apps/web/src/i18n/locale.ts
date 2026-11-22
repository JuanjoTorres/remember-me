export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'rm_locale';

function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Picks the UI language: explicit cookie first, then the browser's Accept-Language order. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', quality] = part.trim().split(';q=');
      return { language: tag.toLowerCase().split('-')[0], weight: quality ? Number(quality) : 1 };
    })
    .filter((entry) => !Number.isNaN(entry.weight))
    .sort((a, b) => b.weight - a.weight)
    .find((entry) => isLocale(entry.language));
  return (preferred?.language as Locale | undefined) ?? DEFAULT_LOCALE;
}
