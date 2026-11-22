const KEY = 'remember-me:gifts';

export interface SavedGift {
  giftId: string;
  editToken: string;
  savedAt: string;
}

function read(): SavedGift[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedGift[]) : [];
  } catch {
    return [];
  }
}

/** Gifts this device can edit, most recent first. The edit token never leaves the device. */
export function listSavedGifts(): SavedGift[] {
  return read().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

let snapshot: { raw: string | null; gifts: SavedGift[] } | undefined;

/** Same list as `listSavedGifts`, with a stable identity while storage is unchanged (for React). */
export function savedGiftsSnapshot(): SavedGift[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage unavailable: behave as if nothing was saved.
  }
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, gifts: listSavedGifts() };
  return snapshot.gifts;
}

export function getEditToken(giftId: string): string | undefined {
  return read().find((gift) => gift.giftId === giftId)?.editToken;
}

export function saveGift(giftId: string, editToken: string): void {
  const others = read().filter((gift) => gift.giftId !== giftId);
  const entry = { giftId, editToken, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify([entry, ...others]));
  } catch {
    // Private mode or full storage: the edit link shown to the creator still works.
  }
}

export function forgetGift(giftId: string): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(read().filter((gift) => gift.giftId !== giftId)),
    );
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/** Private link that reopens the editor on another device. The token travels in the fragment. */
export function editLink(origin: string, giftId: string, editToken: string): string {
  return `${origin}/create/${giftId}#token=${editToken}`;
}

export function tokenFromHash(hash: string): string | undefined {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? undefined;
}
