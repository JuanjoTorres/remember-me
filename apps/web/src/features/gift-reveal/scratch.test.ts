import { describe, expect, it } from 'vitest';
import { clearedRatio } from './scratch';

function surface(pixels: number, clearedPixels: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4).fill(255);
  for (let pixel = 0; pixel < clearedPixels; pixel += 1) data[pixel * 4 + 3] = 0;
  return data;
}

describe('clearedRatio', () => {
  it('is 0 for an untouched surface and 1 for a fully scratched one', () => {
    expect(clearedRatio(surface(1000, 0), 1)).toBe(0);
    expect(clearedRatio(surface(1000, 1000), 1)).toBe(1);
  });

  it('measures the scratched share, also when sampling', () => {
    expect(clearedRatio(surface(1000, 450), 1)).toBeCloseTo(0.45);
    expect(clearedRatio(surface(1600, 800), 16)).toBeCloseTo(0.5, 1);
  });

  it('handles an empty surface', () => {
    expect(clearedRatio(new Uint8ClampedArray(0))).toBe(0);
  });
});
