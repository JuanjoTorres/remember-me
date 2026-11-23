import { z } from 'zod';

export const MediaKindSchema = z.enum(['IMAGE', 'AUDIO']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaUploadResponseSchema = z.object({
  /** Public URL to store in a card or in the reveal. */
  url: z.url(),
  kind: MediaKindSchema,
  contentType: z.string(),
  bytes: z.number().int().positive(),
});
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;

/** Technical upload limits, shared so that the editor can check before sending. */
export const MEDIA_LIMITS = {
  imageMaxBytes: 12 * 1024 * 1024,
  audioMaxBytes: 10 * 1024 * 1024,
  /** Longest edge of a stored image, in pixels. */
  imageMaxEdge: 1600,
} as const;
