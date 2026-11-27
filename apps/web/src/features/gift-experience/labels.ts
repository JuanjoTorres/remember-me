import type { PublicGift } from '@remember-me/shared-types';
import { getTranslations } from 'next-intl/server';
import { buildExperienceLabels } from './build-labels';
import type { ExperienceLabels } from './GiftExperience';

/** Resolves every text of the experience on the server, in the language the gift was written in. */
export async function experienceLabels(gift: PublicGift): Promise<ExperienceLabels> {
  const t = await getTranslations({ locale: gift.locale, namespace: 'experience' });
  return buildExperienceLabels((key, values) => t(key, values), gift);
}
