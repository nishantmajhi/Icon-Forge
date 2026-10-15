/*
 * The decisions about a source image that need no canvas: is it too big to
 * attempt, and is it big enough to be worth attempting.
 *
 * These lived in `resize.ts` next to the canvas work, which meant importing
 * them dragged in `pica` and a DOM. They are arithmetic on two numbers, so
 * they belong on their own where they can be exercised directly.
 */

import type { Preset } from '../presets';

export interface SourceDimensions {
  width: number;
  height: number;
}

/*
 * The ceiling on a source image, and the reasoning for the two numbers.
 *
 * Resizing allocates a canvas the full size of the source, and `pica` then
 * works over its pixels. At four bytes a pixel a 10,000 x 10,000 PNG is 400 MB
 * for the source canvas alone -- which the original allocated once per output
 * size, so selecting every platform meant sixty of them in turn. On a modest
 * machine the tab is killed, and a killed tab reports nothing at all.
 *
 * 8192 on a side is comfortably beyond any icon source that makes sense; the
 * largest icon anything here emits is 1024, and the drop zone asks for 1024.
 * The megapixel cap catches the long-and-thin shapes that slip under a
 * per-side limit -- 8000 x 8000 is under the side cap and is 64 megapixels.
 */
export const MAX_SOURCE_SIDE = 8192;
export const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;

/**
 * Whether this image is too large to process, and why.
 *
 * Returns null when the image is fine, so a caller can `if (refusal)`.
 */
export function checkSourceLimits(dims: SourceDimensions): string | null {
  const { width, height } = dims;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return 'That image reports no usable dimensions, so there is nothing to resize.';
  }

  if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE) {
    return `Source is ${width}×${height}px. The largest side Icon Forge will resize is ${MAX_SOURCE_SIDE}px — scale it down and drop it back in.`;
  }

  const megapixels = width * height;
  if (megapixels > MAX_SOURCE_PIXELS) {
    const mp = (megapixels / (1024 * 1024)).toFixed(0);
    const cap = MAX_SOURCE_PIXELS / (1024 * 1024);
    return `Source is ${width}×${height}px, about ${mp} megapixels. Icon Forge will resize up to ${cap} — scale it down and drop it back in.`;
  }

  return null;
}

/** Warn if the source resolution is too low to cleanly produce the requested max size. */
export function checkResolutionWarning(
  dims: SourceDimensions,
  maxRequestedSize: number,
): string | null {
  const smallestSide = Math.min(dims.width, dims.height);
  if (smallestSide < maxRequestedSize) {
    return `Source is ${dims.width}×${dims.height}px, smaller than the largest requested size (${maxRequestedSize}px). Those outputs will be upscaled and may look soft.`;
  }
  return null;
}

/**
 * The largest output size any of these presets asks for.
 *
 * Returns 0 for an empty selection rather than the -Infinity that
 * `Math.max()` of nothing gives, which would then format into the warning text.
 */
export function largestRequestedSize(presets: Preset[]): number {
  let largest = 0;
  for (const preset of presets) {
    for (const output of preset.outputs) {
      if (output.size > largest) largest = output.size;
    }
  }
  return largest;
}

/**
 * Whether the drop zone should accept this file at all.
 *
 * This is the browser's reported type, which on Windows is derived from the
 * extension -- so it is a first filter and not a guarantee. Anything that gets
 * past it still has to decode, and `loadImage` rejecting is the real check.
 */
export function isPngFile(file: { type: string }): boolean {
  return file.type === 'image/png';
}
