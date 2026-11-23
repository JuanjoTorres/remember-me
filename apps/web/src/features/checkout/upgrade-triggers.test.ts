import { describe, expect, it } from 'vitest';
import { upgradeReasonFor } from './upgrade-triggers';

const free = (cards: number) => ({ plan: 'FREE' as const, cards: Array.from({ length: cards }) });
const premium = { plan: 'PREMIUM' as const, cards: Array.from({ length: 12 }) };

describe('upgradeReasonFor', () => {
  it('lets a free gift add photo cards up to the limit', () => {
    expect(upgradeReasonFor(free(0), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBeNull();
    expect(upgradeReasonFor(free(2), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBeNull();
  });

  it('asks for the upgrade on the fourth card', () => {
    expect(upgradeReasonFor(free(3), { kind: 'ADD_CARD', cardType: 'PHOTO_TEXT' })).toBe(
      'MAX_CARDS',
    );
  });

  it('asks for the upgrade for a voice note or a trivia', () => {
    expect(upgradeReasonFor(free(0), { kind: 'ADD_CARD', cardType: 'AUDIO_NOTE' })).toBe(
      'CARD_TYPE',
    );
    expect(upgradeReasonFor(free(0), { kind: 'ADD_CARD', cardType: 'TRIVIA' })).toBe('CARD_TYPE');
  });

  it('asks for the upgrade for premium reveals, not for the basic one', () => {
    expect(upgradeReasonFor(free(1), { kind: 'PICK_REVEAL', template: 'BASIC' })).toBeNull();
    for (const template of ['SCRATCH_CARD', 'TICKET', 'GIFT_BOX'] as const) {
      expect(upgradeReasonFor(free(1), { kind: 'PICK_REVEAL', template })).toBe('REVEAL_TEMPLATE');
    }
  });

  it('asks for the upgrade to publish without watermark or download the SVG code', () => {
    expect(upgradeReasonFor(free(1), { kind: 'REMOVE_WATERMARK' })).toBe('WATERMARK');
    expect(upgradeReasonFor(free(1), { kind: 'DOWNLOAD_QR_SVG' })).toBe('QR_FORMAT');
  });

  it('never asks a premium gift', () => {
    const intents = [
      { kind: 'ADD_CARD', cardType: 'TRIVIA' },
      { kind: 'ADD_CARD', cardType: 'AUDIO_NOTE' },
      { kind: 'PICK_REVEAL', template: 'GIFT_BOX' },
      { kind: 'REMOVE_WATERMARK' },
      { kind: 'DOWNLOAD_QR_SVG' },
    ] as const;
    for (const intent of intents) expect(upgradeReasonFor(premium, intent)).toBeNull();
  });
});
