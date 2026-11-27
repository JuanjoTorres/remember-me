import type { PublicGift } from '@remember-me/shared-types';
import type messages from '../../../messages/en.json';
import { BRAND_NAME } from '@/features/shared/brand';
import type { ExperienceLabels } from './GiftExperience';

/** A translator bound to the `experience` namespace, in whatever language the gift is written in. */
export type ExperienceTranslator = (
  key: keyof (typeof messages)['experience'],
  values?: Record<string, string>,
) => string;

/**
 * Every text of the experience for one gift. Pure, so that the recipient page can resolve it on
 * the server and the creator's preview in the browser, with the same result.
 */
export function buildExperienceLabels(
  t: ExperienceTranslator,
  gift: Pick<PublicGift, 'recipientName' | 'senderName'>,
): ExperienceLabels {
  return {
    coverEyebrow: t('coverEyebrow'),
    coverFor: gift.recipientName
      ? t('coverFor', { name: gift.recipientName })
      : t('coverForNoName'),
    coverFrom: gift.senderName ? t('coverFrom', { name: gift.senderName }) : '',
    coverStart: t('coverStart'),
    next: t('next'),
    previous: t('previous'),
    play: t('play'),
    pause: t('pause'),
    triviaWrong: t('triviaWrong'),
    triviaRight: t('triviaRight'),
    continue: t('continue'),
    replay: t('replay'),
    watermark: t('watermark', { brand: BRAND_NAME }),
    reveal: {
      BASIC: t('revealBasic'),
      SCRATCH_CARD: t('revealScratch'),
      TICKET: t('revealTicket'),
      GIFT_BOX: t('revealBox'),
      revealNow: t('revealNow'),
      ticketTitle: t('ticketTitle'),
      ticketPassenger: t('ticketPassenger'),
    },
  };
}
