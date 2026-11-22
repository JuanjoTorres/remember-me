import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, LOCALES, type Locale, resolveLocale } from './locale';

async function visitorLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get('accept-language'));
}

export default getRequestConfig(async ({ locale: explicit }) => {
  // An explicit locale wins (a gift is shown in the language it was written in); otherwise the
  // visitor's own preference decides.
  const locale = LOCALES.includes(explicit as Locale)
    ? (explicit as Locale)
    : await visitorLocale();
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
