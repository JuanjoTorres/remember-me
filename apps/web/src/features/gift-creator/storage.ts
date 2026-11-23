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

/** Tokens known in this tab but not (yet) written to storage. */
const sessionTokens = new Map<string, string>();
const listeners = new Set<() => void>();

export function subscribeToTokens(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Uses a token for this tab without storing it. A token that arrives in a link is only stored once
 * the API has accepted it, so a truncated link can never replace a working token.
 */
export function holdEditToken(giftId: string, editToken: string): void {
  sessionTokens.set(giftId, editToken);
  listeners.forEach((listener) => listener());
}

/** Drops a token the API refused, falling back to the stored one if there is any. */
export function dropHeldToken(giftId: string): void {
  if (sessionTokens.delete(giftId)) listeners.forEach((listener) => listener());
}

export function getEditToken(giftId: string): string | undefined {
  return sessionTokens.get(giftId) ?? read().find((gift) => gift.giftId === giftId)?.editToken;
}

export function hasStoredToken(giftId: string): boolean {
  return read().some((gift) => gift.giftId === giftId);
}

export function saveGift(giftId: string, editToken: string): void {
  // Also kept in memory, so the editor works in this tab when storage is unavailable.
  sessionTokens.set(giftId, editToken);
  const others = read().filter((gift) => gift.giftId !== giftId);
  const entry = { giftId, editToken, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify([entry, ...others]));
  } catch {
    // Private mode or full storage: the edit link shown to the creator still works.
  }
}

export function forgetGift(giftId: string): void {
  sessionTokens.delete(giftId);
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
