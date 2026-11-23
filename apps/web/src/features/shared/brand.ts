/**
 * The product's public name. This is the only place it is written: components render it with
 * `BrandMark`, and translations receive it as the `{brand}` value.
 */
export const BRAND = { name: 'kardoo', tld: '.me' } as const;

export const BRAND_NAME = `${BRAND.name}${BRAND.tld}`;
