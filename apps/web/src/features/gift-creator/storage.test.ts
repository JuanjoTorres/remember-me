import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropHeldToken,
  editLink,
  forgetGift,
  getEditToken,
  hasStoredToken,
  holdEditToken,
  listSavedGifts,
  saveGift,
  tokenFromHash,
} from './storage';

describe('edit token storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const id of ['g1', 'g2']) forgetGift(id);
  });

  it('round-trips the token through the private edit link', () => {
    const link = editLink('https://kardoo.me', 'g1', 'secret_token-123');
    expect(link).toBe('https://kardoo.me/create/g1#token=secret_token-123');
    expect(tokenFromHash(new URL(link).hash)).toBe('secret_token-123');
    expect(tokenFromHash('')).toBeUndefined();
    expect(tokenFromHash('#other=1')).toBeUndefined();
  });

  it('remembers gifts, most recent first, and forgets them', () => {
    saveGift('g1', 't1');
    saveGift('g2', 't2');
    saveGift('g1', 't1-new');
    expect(getEditToken('g1')).toBe('t1-new');
    expect(
      listSavedGifts()
        .map((gift) => gift.giftId)
        .sort(),
    ).toEqual(['g1', 'g2']);
    forgetGift('g1');
    expect(getEditToken('g1')).toBeUndefined();
  });

  it('does not let a token from a link replace the stored one until it is accepted', () => {
    saveGift('g1', 'working-token');
    forgetGift('g2');
    // A truncated link is opened in this tab.
    holdEditToken('g1', 'broken');
    expect(getEditToken('g1')).toBe('broken');
    expect(hasStoredToken('g1')).toBe(true);
    expect(listSavedGifts()[0]?.editToken).toBe('working-token');
    // The API refuses it: the device still has its working token.
    dropHeldToken('g1');
    expect(getEditToken('g1')).toBe('working-token');
  });

  it('keeps working in the tab when storage is unavailable', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      saveGift('g2', 'session-only');
      expect(getEditToken('g2')).toBe('session-only');
      expect(hasStoredToken('g2')).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
