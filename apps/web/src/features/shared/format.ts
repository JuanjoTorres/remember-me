/** Formats an amount in the smallest currency unit, e.g. (499, 'eur', 'es') -> "4,99 €". */
export function formatPrice(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/** The gift link as people read it: host and path, without the protocol. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/**
 * A moment as the person looking at the screen lives it: in the time zone of their device, not of
 * the server. Only for data loaded in the browser; `timeZone` exists for tests.
 */
export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** The day of a moment, in the time zone of the device. */
export function formatDay(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(new Date(iso));
}
