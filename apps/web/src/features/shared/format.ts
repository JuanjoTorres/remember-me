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
