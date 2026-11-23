import { MEDIA_LIMITS } from '@remember-me/shared-types';

export interface Size {
  width: number;
  height: number;
}

/** Scales a size down so that its longest edge fits `maxEdge`; never scales up. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/**
 * Shrinks a photo in the browser before upload, so that a 10 MB camera picture becomes a few
 * hundred KB on a mobile connection. Falls back to the original file if the browser cannot decode it.
 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap, MEDIA_LIMITS.imageMaxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
