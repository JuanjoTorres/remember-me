/** A draft that is never published is deleted this long after it was started. */
export const DRAFT_TTL_DAYS = 7;
/** A gift published on the free plan is deleted this long after publication. A paid gift never is. */
export const FREE_GIFT_TTL_MONTHS = 3;
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

/** The same day of the month that many months later, or the last day of a shorter month. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return result;
}

export function draftExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DRAFT_TTL_DAYS * 24 * HOUR_MS);
}

export function freeGiftExpiry(publishedAt: Date): Date {
  return addMonths(publishedAt, FREE_GIFT_TTL_MONTHS);
}

/** End of the correction window of a published gift; a manual lock can only bring it forward. */
export function editableUntil(publishedAt: Date, lockedAt: Date | null = null): Date {
  const graceEnd = new Date(publishedAt.getTime() + EDIT_GRACE_HOURS * HOUR_MS);
  return lockedAt !== null && lockedAt < graceEnd ? lockedAt : graceEnd;
}
