import { describe, expect, it } from 'vitest';
import {
  checkAddCard,
  checkQrFormat,
  checkRevealTemplate,
  PLAN_CAPABILITIES,
  proFeaturesOf,
} from './plans.js';

describe('plan capabilities', () => {
  it('FREE allows up to three photo cards', () => {
    expect(checkAddCard('FREE', 0, 'PHOTO_TEXT')).toEqual({ allowed: true });
    expect(checkAddCard('FREE', 2, 'PHOTO_TEXT')).toEqual({ allowed: true });
    expect(checkAddCard('FREE', 3, 'PHOTO_TEXT')).toEqual({
      allowed: false,
      capability: 'MAX_CARDS',
    });
  });

  it('FREE blocks voice notes and trivia, whatever the card count', () => {
    expect(checkAddCard('FREE', 0, 'AUDIO_NOTE')).toEqual({
      allowed: false,
      capability: 'CARD_TYPE',
    });
    expect(checkAddCard('FREE', 0, 'TRIVIA')).toEqual({ allowed: false, capability: 'CARD_TYPE' });
  });

  it('PREMIUM has no card limit and every card type', () => {
    expect(checkAddCard('PREMIUM', 40, 'AUDIO_NOTE')).toEqual({ allowed: true });
    expect(checkAddCard('PREMIUM', 40, 'TRIVIA')).toEqual({ allowed: true });
  });

  it('only PREMIUM gets the three reveal templates', () => {
    expect(checkRevealTemplate('FREE', 'BASIC')).toEqual({ allowed: true });
    for (const template of ['SCRATCH_CARD', 'TICKET', 'GIFT_BOX'] as const) {
      expect(checkRevealTemplate('FREE', template)).toEqual({
        allowed: false,
        capability: 'REVEAL_TEMPLATE',
      });
      expect(checkRevealTemplate('PREMIUM', template)).toEqual({ allowed: true });
    }
  });

  it('FREE keeps the watermark and gets a PNG code only', () => {
    expect(PLAN_CAPABILITIES.FREE.watermark).toBe(true);
    expect(PLAN_CAPABILITIES.PREMIUM.watermark).toBe(false);
    expect(checkQrFormat('FREE', 'svg')).toEqual({ allowed: false, capability: 'QR_FORMAT' });
    expect(checkQrFormat('PREMIUM', 'svg')).toEqual({ allowed: true });
  });

  it('finds no paid feature in a gift the free plan allows', () => {
    const photos = Array.from({ length: PLAN_CAPABILITIES.FREE.maxCards ?? 0 }, () => ({
      type: 'PHOTO_TEXT' as const,
    }));
    expect(proFeaturesOf({ cards: photos, reveal: { template: 'BASIC' } })).toEqual([]);
  });

  it('lists each paid feature a gift uses, once', () => {
    const photo = { type: 'PHOTO_TEXT' as const };
    const overTheLimit = Array.from(
      { length: (PLAN_CAPABILITIES.FREE.maxCards ?? 0) + 1 },
      () => photo,
    );
    expect(proFeaturesOf({ cards: overTheLimit, reveal: { template: 'BASIC' } })).toEqual([
      'EXTRA_CARDS',
    ]);
    expect(
      proFeaturesOf({
        cards: [{ type: 'AUDIO_NOTE' }, { type: 'AUDIO_NOTE' }, { type: 'TRIVIA' }],
        reveal: { template: 'TICKET' },
      }),
    ).toEqual(['VOICE_NOTE', 'TRIVIA', 'PREMIUM_REVEAL']);
  });
});
