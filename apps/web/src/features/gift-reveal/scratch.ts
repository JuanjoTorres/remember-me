/** Share of a scratch surface that must be cleared before the rest is removed automatically. */
export const SCRATCH_THRESHOLD = 0.45;

/**
 * Fraction (0..1) of transparent pixels in RGBA image data. Samples one pixel every `stride` to stay
 * cheap enough to run while the finger moves.
 */
export function clearedRatio(rgba: Uint8ClampedArray, stride = 16): number {
  let sampled = 0;
  let cleared = 0;
  for (let alpha = 3; alpha < rgba.length; alpha += 4 * stride) {
    sampled += 1;
    if (rgba[alpha] === 0) cleared += 1;
  }
  return sampled === 0 ? 0 : cleared / sampled;
}
