import { BRAND } from '../brand';

/** The brand name as a wordmark, with the ending highlighted. */
export function BrandMark() {
  return (
    <>
      {BRAND.name}
      <span className="text-ember">{BRAND.tld}</span>
    </>
  );
}
