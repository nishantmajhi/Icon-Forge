/*
 * Palette extraction by median cut.
 *
 * The method, because a palette nobody can explain is a palette nobody can
 * compare to another tool's:
 *
 *  1. Sample the opaque pixels on an evenly spaced grid, up to about 20,000 of
 *     them. Anything with an alpha below 128 is ignored entirely rather than
 *     blended towards white, so a transparent background contributes nothing.
 *  2. Put every sample in one box. Repeatedly take the box whose widest colour
 *     channel spans the greatest range and split it at the median of that
 *     channel, until there are as many boxes as colours wanted or no box can be
 *     split any further.
 *  3. Average each box, merge boxes that averaged to the same colour, and order
 *     what is left by how many pixels it accounts for.
 *
 * Two consequences worth knowing. An image of one colour yields one swatch, not
 * a row of identical ones -- step 2 stops as soon as no box has any range left.
 * And a box that straddles a boundary between two colours averages to a colour
 * that is in neither, so an image of two flat colours in unequal measure can
 * produce a blend of them as a third swatch. That is inherent to median cut;
 * the alternative is k-means, which is slower and not obviously better here.
 */

type RGB = [number, number, number];

/*
 * Roughly how many pixels to look at. Chosen so that the 128px canvas this is
 * actually handed is read in full (16,384 pixels, so a stride of one) while a
 * 4096px source still costs well under a megabyte of samples.
 */
const TARGET_SAMPLES = 20000;

/** Alpha at or above this counts as part of the image. */
const OPAQUE_ENOUGH = 128;

function toHex([r, g, b]: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * The widest channel of a set of pixels, and how wide it is.
 *
 * A box whose widest channel spans nothing is a box of one colour, and there is
 * no point splitting it -- which is what stops a single-colour image producing
 * `count` copies of itself.
 */
function widestChannel(pixels: RGB[]): { channel: 0 | 1 | 2; range: number } {
  let best: { channel: 0 | 1 | 2; range: number } = { channel: 0, range: -1 };
  for (const channel of [0, 1, 2] as const) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of pixels) {
      const v = p[channel];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    if (range > best.range) best = { channel, range };
  }
  return best;
}

function averageOf(pixels: RGB[]): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Split boxes until there are `maxBoxes` of them or none can be split.
 *
 * This is the part the original got structurally wrong. It recursed to a fixed
 * depth of `ceil(log2(count))` and so always produced a power of two boxes --
 * eight for the five colours the app asks for -- and then discarded three of
 * them. Splitting on demand instead produces exactly as many boxes as are
 * wanted, and no more than the image can actually supply.
 */
function medianCut(pixels: RGB[], maxBoxes: number): RGB[][] {
  let boxes = [{ pixels, spread: widestChannel(pixels) }];

  while (boxes.length < maxBoxes) {
    // The box with the most room in it; ties go to the more populous one.
    let target = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (
        target === -1 ||
        boxes[i].spread.range > boxes[target].spread.range ||
        (boxes[i].spread.range === boxes[target].spread.range &&
          boxes[i].pixels.length > boxes[target].pixels.length)
      ) {
        target = i;
      }
    }
    if (target === -1 || boxes[target].spread.range === 0) break;

    const { pixels: box, spread } = boxes[target];
    const sorted = [...box].sort((a, b) => a[spread.channel] - b[spread.channel]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);

    // A non-zero range guarantees at least two pixels, so neither half is empty.
    boxes = [
      ...boxes.slice(0, target),
      { pixels: left, spread: widestChannel(left) },
      { pixels: right, spread: widestChannel(right) },
      ...boxes.slice(target + 1),
    ];
  }

  return boxes.map((b) => b.pixels);
}

/**
 * Extract a palette of dominant colours from a canvas, most dominant first.
 *
 * May return fewer than `count` colours -- an image with fewer distinct colours
 * than that has no more to give, and repeating one would be a lie about the
 * image rather than a palette.
 */
export function extractPalette(canvas: HTMLCanvasElement, count = 5): string[] {
  if (count < 1) return [];

  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  /*
   * Sample on a two-dimensional grid rather than by striding the row-major
   * index. A single stride over the flat index shares a factor with the width
   * whenever the width is a round number -- and the stride is derived from
   * width x height, so it usually does. A 2000x2000 image gave a stride of 400,
   * which divides 2000, so every sample landed in one of five columns and the
   * other 1,995 were never looked at.
   */
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / TARGET_SAMPLES)));

  const pixels: RGB[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < OPAQUE_ENOUGH) continue;
      pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  if (pixels.length === 0) return [];

  /*
   * Merge boxes that averaged to the same colour, keeping the pixel count so
   * that "dominant" means dominant and not merely "first out of the recursion".
   */
  const weights = new Map<string, number>();
  for (const box of medianCut(pixels, count)) {
    const hex = toHex(averageOf(box));
    weights.set(hex, (weights.get(hex) ?? 0) + box.length);
  }

  return [...weights.entries()]
    // Pixel count descending, then hex ascending so the result never depends on
    // Map iteration order for images where two colours are exactly level.
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, count)
    .map(([hex]) => hex);
}
