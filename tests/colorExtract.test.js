/*
 * The palette extractor.
 *
 * `extractPalette` takes a canvas and returns hex strings for the sidebar
 * swatches. It needs no DOM: the only thing it touches is
 * `canvas.getContext('2d').getImageData(...)`, so a plain object with a
 * `getImageData` on it is a complete stand-in, and every pixel of every
 * fixture here is known in advance.
 *
 * Constructing the input pixel by pixel is what makes these assertions worth
 * anything. A photograph would produce five plausible colours from almost any
 * quantiser, correct or not. A canvas that is exactly one colour has exactly
 * one answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPalette } from '../src/lib/colorExtract.ts';

/*
 * A stand-in canvas. `fill(i, width, height)` returns the RGBA of pixel `i` in
 * row-major order, which is the order `getImageData` reports.
 */
function canvasOf(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b, a] = fill(i, width, height);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data, width, height }) }),
  };
}

const solid = (w, h, rgba) => canvasOf(w, h, () => rgba);

const OPAQUE_BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

// ------------------------------------------------- what the answer must be ---

/*
 * The assertion the original code fails most plainly: an image of one colour
 * has a palette of one colour. The original asked median cut for eight buckets
 * regardless of how many colours were present, then took the first five in
 * luminance order, so a solid fill produced the same hex five times and the
 * sidebar drew five identical swatches.
 */
test('a single-colour image has a single-colour palette', () => {
  const palette = extractPalette(solid(64, 64, [10, 20, 30, 255]), 5);
  assert.deepEqual(palette, ['#0A141E']);
});

test('a two-colour image has a two-colour palette', () => {
  const palette = extractPalette(canvasOf(64, 64, (i) => (i % 2 ? RED : BLUE)), 5);
  assert.equal(palette.length, 2, `expected two colours, got ${JSON.stringify(palette)}`);
  assert.deepEqual([...palette].sort(), ['#0000FF', '#FF0000']);
});

test('no colour is ever returned twice', () => {
  const cases = {
    solid: solid(64, 64, [200, 100, 50, 255]),
    twoColour: canvasOf(64, 64, (i) => (i % 2 ? RED : BLUE)),
    threeColour: canvasOf(60, 60, (i) => [RED, BLUE, WHITE][i % 3]),
    mostlyOneColour: canvasOf(100, 100, (i) => (i < 9000 ? [139, 0, 0, 255] : WHITE)),
  };
  for (const [name, canvas] of Object.entries(cases)) {
    const palette = extractPalette(canvas, 5);
    assert.equal(new Set(palette).size, palette.length,
      `${name} produced duplicates: ${JSON.stringify(palette)}`);
  }
});

test('a four-colour image returns all four', () => {
  const colours = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ];
  const palette = extractPalette(canvasOf(64, 64, (i) => colours[i % 4]), 5);
  assert.deepEqual([...palette].sort(), ['#0000FF', '#00FF00', '#FF0000', '#FFFF00']);
});

/*
 * The consequence of choosing which buckets to keep by luminance: the darkest
 * ones are the ones dropped. An image that is almost entirely dark with a
 * small bright accent is a common logo, and its brand colour is the dark one.
 */
test('the dominant colour of a dark image survives into the palette', () => {
  const palette = extractPalette(
    canvasOf(100, 100, (i) => (i < 9500 ? OPAQUE_BLACK : [255, 200, 0, 255])),
    5,
  );
  assert.ok(palette.includes('#000000'),
    `the colour of 95% of the pixels is missing from ${JSON.stringify(palette)}`);
});

test('the dominant colour comes first', () => {
  // 80% mid-grey, 20% white. Sorting by luminance would put white first.
  const palette = extractPalette(
    canvasOf(100, 100, (i) => (i < 8000 ? [128, 128, 128, 255] : WHITE)),
    5,
  );
  assert.equal(palette[0], '#808080', `expected the majority colour first, got ${JSON.stringify(palette)}`);
});

test('never returns more than the requested count', () => {
  for (const count of [1, 2, 3, 4, 5, 8]) {
    const palette = extractPalette(
      canvasOf(64, 64, (i) => [(i * 37) & 0xff, (i * 91) & 0xff, (i * 151) & 0xff, 255]),
      count,
    );
    assert.ok(palette.length <= count, `asked for ${count}, got ${palette.length}`);
  }
});

test('every returned string is a six-digit uppercase hex colour', () => {
  const palette = extractPalette(
    canvasOf(64, 64, (i) => [(i * 37) & 0xff, (i * 91) & 0xff, (i * 151) & 0xff, 255]),
    5,
  );
  assert.ok(palette.length > 0);
  for (const hex of palette) {
    assert.match(hex, /^#[0-9A-F]{6}$/, `${hex} is not a hex colour`);
  }
});

// ------------------------------------------------------------- alpha ---------

test('a fully transparent image has an empty palette', () => {
  assert.deepEqual(extractPalette(solid(32, 32, [1, 2, 3, 0]), 5), []);
});

/*
 * These two assert on the *set* of colours rather than the list, so that they
 * are about alpha and nothing else. Asserting on the list would make them fail
 * for the unrelated duplicate-swatch defect above, and a test that fails for
 * two reasons tells you neither.
 */
test('transparent pixels do not contribute their colour', () => {
  // Half opaque red, half transparent green. The green must not appear, and
  // must not be averaged into the red either.
  const palette = extractPalette(
    canvasOf(64, 64, (i) => (i % 2 ? [255, 0, 0, 255] : [0, 255, 0, 0])),
    5,
  );
  assert.deepEqual([...new Set(palette)], ['#FF0000']);
});

test('the alpha cutoff is halfway, and it is a threshold not a blend', () => {
  const justOpaque = extractPalette(solid(32, 32, [40, 80, 120, 128]), 3);
  const justTransparent = extractPalette(solid(32, 32, [40, 80, 120, 127]), 3);
  assert.deepEqual([...new Set(justOpaque)], ['#285078'], 'alpha 128 counts');
  assert.deepEqual(justTransparent, [], 'alpha 127 does not');
});

// ------------------------------------------------------------- sampling -----

/*
 * The extractor samples rather than reading every pixel, and the original
 * sampled by walking the row-major index with a single stride. When that
 * stride shares a factor with the image width -- which it does whenever the
 * width is a round number, because the stride is derived from width x height --
 * the samples land in a handful of vertical stripes and the rest of the image
 * is never looked at.
 *
 * A 2000 x 2000 image gives a stride of 400, and 400 divides 2000, so the
 * original read columns 0, 400, 800, 1200 and 1600 and no others -- five
 * columns out of two thousand. The fixture below paints red down exactly those
 * columns and blue everywhere else, so red is a quarter of one percent of the
 * image and every single sample lands on it.
 *
 * Against the original this returns a palette of nothing but red for an image
 * that is 99.75% blue.
 *
 * In the app as it stands `extractPalette` is only ever handed a 128px canvas,
 * where the stride is 1 and this cannot bite. It is a latent defect in a
 * function that reads like a general one, not a live one.
 */
test('sampling covers the whole image, not a grid aligned to its own stride', () => {
  const width = 2000;
  const height = 2000;
  const canvas = canvasOf(width, height, (i, w) => ((i % w) % 400 === 0 ? RED : BLUE));
  const palette = extractPalette(canvas, 4);
  assert.ok(palette.includes('#0000FF'),
    `99.75% of this image is blue and the palette is ${JSON.stringify(palette)}`);
});

test('sampling sees rows as well as columns', () => {
  // The same trap one axis over: stride 400 over a 2000-wide image advances
  // five columns and then one row, so a fixture striped by row is sampled on
  // every row but only ever in those five columns.
  const width = 2000;
  const height = 2000;
  const canvas = canvasOf(width, height, (i, w) => (Math.floor(i / w) % 2 === 0 ? RED : BLUE));
  const palette = extractPalette(canvas, 4);
  assert.ok(palette.includes('#FF0000'), `even rows missing from ${JSON.stringify(palette)}`);
  assert.ok(palette.includes('#0000FF'), `odd rows missing from ${JSON.stringify(palette)}`);
});

test('a large image is not read pixel by pixel', () => {
  // Nothing asserts a time here; what is asserted is that the function
  // returns at all on an image big enough that reading every pixel into an
  // array of triples would be several hundred megabytes.
  const canvas = canvasOf(3000, 3000, (i) => [i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, 255]);
  const palette = extractPalette(canvas, 5);
  assert.ok(palette.length > 0 && palette.length <= 5);
});

// ------------------------------------------------------------- determinism ---

test('the same image always gives the same palette', () => {
  const make = () => canvasOf(80, 80, (i) => [(i * 7) & 0xff, (i * 29) & 0xff, (i * 113) & 0xff, 255]);
  const a = extractPalette(make(), 5);
  const b = extractPalette(make(), 5);
  assert.deepEqual(a, b);
});
