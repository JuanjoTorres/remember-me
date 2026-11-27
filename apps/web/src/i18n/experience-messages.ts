import en from '../../messages/en.json';
import es from '../../messages/es.json';
import type { Locale } from './locale';

export type ExperienceMessages = (typeof en)['experience'];

/**
 * The recipient texts in every language. Server only: a page passes them down as props where the
 * browser has to render a gift in its own language (the creator's preview), so that the client
 * bundle never carries whole message files.
 */
export const EXPERIENCE_MESSAGES: Record<Locale, ExperienceMessages> = {
  en: en.experience,
  es: es.experience,
};
