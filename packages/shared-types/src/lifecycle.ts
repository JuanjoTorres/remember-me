/** A draft that is never published is deleted this long after it was started. */
export const DRAFT_TTL_DAYS = 7;
/** A gift published on the free plan is deleted this long after publication. A paid gift never is. */
export const FREE_GIFT_TTL_YEARS = 1;
/** After publication the creator may still fix typos and swap photos for this long. */
export const EDIT_GRACE_HOURS = 48;
/** A paid gift's buyer is invited to relive it this long after publication. */
export const ANNIVERSARY_YEARS = 1;

const HOUR_MS = 60 * 60 * 1000;

export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

export function draftExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DRAFT_TTL_DAYS * 24 * HOUR_MS);
}

export function freeGiftExpiry(publishedAt: Date): Date {
  return addYears(publishedAt, FREE_GIFT_TTL_YEARS);
}

/** End of the correction window of a published gift; a manual lock can only bring it forward. */
export function editableUntil(publishedAt: Date, lockedAt: Date | null = null): Date {
  const graceEnd = new Date(publishedAt.getTime() + EDIT_GRACE_HOURS * HOUR_MS);
  return lockedAt !== null && lockedAt < graceEnd ? lockedAt : graceEnd;
}
