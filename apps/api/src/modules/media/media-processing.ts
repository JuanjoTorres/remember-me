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
  if (isMp3(input)) return { body: input, contentType: 'audio/mpeg', extension: 'mp3' };
  if (isAudioOnlyMp4(input)) return { body: input, contentType: 'audio/mp4', extension: 'm4a' };
  throw new AppError('UNSUPPORTED_MEDIA', 'Upload an M4A or MP3 audio file');
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

/** Length in bytes of the MPEG Layer III frame starting at `offset`, or null if there is none. */
function mp3FrameLength(input: Buffer, offset: number): number | null {
  if (offset + 4 > input.length) return null;
  const [b0, b1, b2] = [input[offset]!, input[offset + 1]!, input[offset + 2]!];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  const bitrateIndex = b2 >> 4;
  const sampleRate = SAMPLE_RATES[version]?.[(b2 >> 2) & 0x03];
  if (layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || !sampleRate) return null;
  const padding = (b2 >> 1) & 0x01;
  const bitrate = (version === 3 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex]! * 1000;
  return Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
}

/** An optional ID3v2 tag followed by at least two consecutive, well-formed MP3 frames. */
function isMp3(input: Buffer): boolean {
  let offset = 0;
  if (input.subarray(0, 3).toString('latin1') === 'ID3' && input.length > 10) {
    const size =
      ((input[6]! & 0x7f) << 21) |
      ((input[7]! & 0x7f) << 14) |
      ((input[8]! & 0x7f) << 7) |
      (input[9]! & 0x7f);
    offset = 10 + size;
  }
  const first = mp3FrameLength(input, offset);
  return first !== null && mp3FrameLength(input, offset + first) !== null;
}

const NON_AUDIO_BRANDS = ['heic', 'heix', 'hevc', 'avif', 'avis', 'mif1', 'msf1', 'qt  '];

/** An ISO media file (MP4 family) that declares a sound track and no video track. */
function isAudioOnlyMp4(input: Buffer): boolean {
  if (input.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
  if (NON_AUDIO_BRANDS.includes(input.subarray(8, 12).toString('latin1'))) return false;
  const handlers = new Set<string>();
  for (
    let at = input.indexOf('hdlr', 0, 'latin1');
    at !== -1;
    at = input.indexOf('hdlr', at + 4, 'latin1')
  ) {
    // Box type, then version/flags (4) and pre_defined (4), then the handler type.
    handlers.add(input.subarray(at + 12, at + 16).toString('latin1'));
  }
  return handlers.has('soun') && !handlers.has('vide');
}
