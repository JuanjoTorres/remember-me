import { describe, expect, it } from 'vitest';
import { type CreatorIntent, upgradeReasonFor } from './upgrade-triggers';

const gift = (plan: 'FREE' | 'PREMIUM', status: 'DRAFT' | 'PUBLISHED', cards: number) => ({
  plan,
  status,
  cards: Array.from({ length: cards }),
});
const draft = (cards: number) => gift('FREE', 'DRAFT', cards);
const published = (cards: number) => gift('FREE', 'PUBLISHED', cards);

describe('upgradeReasonFor', () => {
  it('never stops a draft while it is being built', () => {
    const intents: CreatorIntent[] = [
      { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' },
      { kind: 'ADD_CARD', cardType: 'AUDIO_NOTE' },
      { kind: 'ADD_CARD', cardType: 'TRIVIA' },
      { kind: 'PICK_REVEAL', template: 'SCRATCH_CARD' },
      { kind: 'PICK_REVEAL', template: 'TICKET' },
      { kind: 'PICK_REVEAL', template: 'GIFT_BOX' },
    ];
    // Also far past the free number of cards.
    for (const cards of [0, 3, 12]) {
      for (const intent of intents) expect(upgradeReasonFor(draft(cards), intent)).toBeNull();
    }
  });

  it('lets a published free gift add photo cards up to the limit', () => {
    expect(upgradeReasonFor(published(1), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBeNull();
    expect(upgradeReasonFor(published(2), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBeNull();
  });

  it('asks a published free gift for the upgrade on the fourth card', () => {
    expect(upgradeReasonFor(published(3), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBe(
      'MAX_CARDS',
    );
  });

  it('asks a published free gift for the upgrade for a voice note or a trivia', () => {
    expect(upgradeReasonFor(published(1), { kind: 'ADD_CARD', cardType: 'AUDIO_NOTE' })).toBe(
      'CARD_TYPE',
    );
    expect(upgradeReasonFor(published(1), { kind: 'ADD_CARD', cardType: 'TRIVIA' })).toBe(
      'CARD_TYPE',
    );
  });

  it('asks a published free gift for the upgrade for premium reveals, not for the basic one', () => {
    expect(upgradeReasonFor(published(1), { kind: 'PICK_REVEAL', template: 'BASIC' })).toBeNull();
    for (const template of ['SCRATCH_CARD', 'TICKET', 'GIFT_BOX'] as const) {
      expect(upgradeReasonFor(published(1), { kind: 'PICK_REVEAL', template })).toBe(
        'REVEAL_TEMPLATE',
      );
    }
  });

  it('asks for the upgrade to remove the watermark or download the SVG code, draft or not', () => {
    for (const free of [draft(1), published(1)]) {
      expect(upgradeReasonFor(free, { kind: 'REMOVE_WATERMARK' })).toBe('WATERMARK');
      expect(upgradeReasonFor(free, { kind: 'DOWNLOAD_QR_SVG' })).toBe('QR_FORMAT');
    }
  });

  it('never asks a premium gift', () => {
    const intents = [
      { kind: 'ADD_CARD', cardType: 'TRIVIA' },
      { kind: 'ADD_CARD', cardType: 'AUDIO_NOTE' },
      { kind: 'PICK_REVEAL', template: 'GIFT_BOX' },
      { kind: 'REMOVE_WATERMARK' },
      { kind: 'DOWNLOAD_QR_SVG' },
    ] as const;
    for (const status of ['DRAFT', 'PUBLISHED'] as const) {
      for (const intent of intents) {
        expect(upgradeReasonFor(gift('PREMIUM', status, 12), intent)).toBeNull();
      }
    }
  });
});
