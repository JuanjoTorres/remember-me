import { MEDIA_LIMITS } from '@remember-me/shared-types';
import sharp from 'sharp';
import { AppError } from '../../shared/http/app-error.js';

export interface ProcessedMedia {
  body: Buffer;
  contentType: string;
  extension: string;
}

const ACCEPTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp'];
/** Decoding guard against decompression bombs. */
const MAX_INPUT_PIXELS = 50_000_000;

/** Re-encodes any accepted image as WebP, upright, without metadata (EXIF location included). */
export async function processImage(input: Buffer): Promise<ProcessedMedia> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await image.metadata();
    if (!format || !ACCEPTED_IMAGE_FORMATS.includes(format)) throw new Error('format');
    const body = await image
      .rotate()
      .resize(MEDIA_LIMITS.imageMaxEdge, MEDIA_LIMITS.imageMaxEdge, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    return { body, contentType: 'image/webp', extension: 'webp' };
  } catch {
    throw new AppError('UNSUPPORTED_MEDIA', 'Upload a JPEG, PNG or WebP image');
  }
}

/** Accepts MP3 and M4A by their content, not by the declared type or file name. */
export function processAudio(input: Buffer): ProcessedMedia {
  const isMp3 =
    input.subarray(0, 3).toString('latin1') === 'ID3' ||
    (input.length > 2 && input[0] === 0xff && ((input[1] ?? 0) & 0xe0) === 0xe0);
  if (isMp3) return { body: input, contentType: 'audio/mpeg', extension: 'mp3' };

  const isMp4 = input.subarray(4, 8).toString('latin1') === 'ftyp';
  if (isMp4) return { body: input, contentType: 'audio/mp4', extension: 'm4a' };

  throw new AppError('UNSUPPORTED_MEDIA', 'Upload an M4A or MP3 audio file');
}
