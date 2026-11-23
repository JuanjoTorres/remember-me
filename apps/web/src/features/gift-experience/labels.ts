import type { PublicGift } from '@remember-me/shared-types';
import { getTranslations } from 'next-intl/server';
import type { ExperienceLabels } from './GiftExperience';

/** Resolves every text of the experience on the server, in the language the gift was written in. */
export async function experienceLabels(gift: PublicGift): Promise<ExperienceLabels> {
  const t = await getTranslations({ locale: gift.locale, namespace: 'experience' });
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
    watermark: t('watermark'),
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
