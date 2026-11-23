import type { CardInput, Reveal } from '@remember-me/shared-types';
import { AppError } from '../../shared/http/app-error.js';

const IMAGE_EXTENSIONS = ['.webp'];
const AUDIO_EXTENSIONS = ['.m4a', '.mp3'];

/**
 * Cards may only point at files uploaded for the same gift. Media is stored under
 * `<MEDIA_PUBLIC_URL>/gifts/<giftId>/`, so the URL alone proves where a file belongs and the gifts
 * module does not need to ask the media module.
 */
export class MediaUrlPolicy {
  constructor(
    private readonly mediaPublicUrl: string,
    private readonly giftId: string,
  ) {}

  assertCard(card: CardInput): void {
    if (card.type === 'TRIVIA') return;
    this.assert(card.payload.imageUrl, IMAGE_EXTENSIONS, 'imageUrl');
    if (card.type === 'AUDIO_NOTE')
      this.assert(card.payload.audioUrl, AUDIO_EXTENSIONS, 'audioUrl');
  }

  assertReveal(reveal: Partial<Reveal>): void {
    this.assert(reveal.imageUrl, IMAGE_EXTENSIONS, 'reveal.imageUrl');
  }

  private assert(url: string | null | undefined, extensions: string[], field: string): void {
    if (url === null || url === undefined) return;
    const prefix = `${this.mediaPublicUrl}/gifts/${this.giftId}/`;
    const fileName = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    const valid =
      /^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(fileName) &&
      extensions.some((ext) => fileName.endsWith(ext));
    if (!valid) {
      throw new AppError('VALIDATION_ERROR', 'Media must be uploaded for this gift first', [
        { path: field, message: 'Not a file uploaded for this gift' },
      ]);
    }
  }
}
