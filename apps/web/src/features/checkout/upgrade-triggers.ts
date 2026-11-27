import {
  type CardType,
  checkAddCard,
  checkRevealTemplate,
  type GiftStatus,
  type Plan,
  type PremiumCapability,
  type RevealTemplate,
} from '@remember-me/shared-types';

/** Something the creator is about to do that may need the full experience. */
export type CreatorIntent =
  | { kind: 'ADD_CARD'; cardType: CardType }
  | { kind: 'PICK_REVEAL'; template: RevealTemplate }
  | { kind: 'REMOVE_WATERMARK' }
  | { kind: 'DOWNLOAD_QR_SVG' };

/** Why the upgrade sheet opens. `WATERMARK` has no API counterpart: it is the creator's own wish. */
export type UpgradeReason = PremiumCapability | 'WATERMARK';

/**
 * Decides, before calling the API, whether an action needs an upgrade. Uses the same plan rules as
 * the backend, which enforces them again.
 *
 * A draft is never stopped while it is being built: every card type, any number of cards and every
 * reveal can be tried for free. What the gift ends up using is paid for once, when it is published.
 */
export function upgradeReasonFor(
  gift: { plan: Plan; status: GiftStatus; cards: readonly unknown[] },
  intent: CreatorIntent,
): UpgradeReason | null {
  if (gift.plan === 'PREMIUM') return null;
  const building = gift.status === 'DRAFT';
  switch (intent.kind) {
    case 'ADD_CARD': {
      if (building) return null;
      const check = checkAddCard(gift.plan, gift.cards.length, intent.cardType);
      return check.allowed ? null : check.capability;
    }
    case 'PICK_REVEAL': {
      if (building) return null;
      const check = checkRevealTemplate(gift.plan, intent.template);
      return check.allowed ? null : check.capability;
    }
    case 'REMOVE_WATERMARK':
      return 'WATERMARK';
    case 'DOWNLOAD_QR_SVG':
      return 'QR_FORMAT';
  }
}
