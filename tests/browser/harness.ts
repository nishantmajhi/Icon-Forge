/*
 * The checks that need a browser.
 *
 * Everything in `tests/*.test.js` runs under Node, which means it can reach the
 * writers, the presets, the plan and the palette -- but not one line of the part
 * that turns an image into bytes. `resize.ts` needs a canvas and `pica`, and
 * `pipeline.ts` needs both plus JSZip's browser build. That is the half where a
 * bug reaches the file the user downloads, so it needs a real browser.
 *
 * Every assertion is made here, in the page, and the results are written into
 * `#out` as JSON. `tests/browser/run.js` reads them back out of the dumped DOM.
 * Nothing is asserted in Node, so what is checked is what the browser produced.
 *
 * `--original` mode is what makes this a regression suite rather than a
 * description. See the header of `run.js`: it builds a second copy of this file
 * against the code as it was at the first commit, and the checks named
 * "regression:" below are the ones expected to fail there.
 */

import JSZip from 'jszip';

// `ORIGINAL` is replaced by run.js. In original mode the imports below resolve
// to a tree extracted from the first commit, which has neither `buildZipBlob`
// nor `zipPlan`, so those checks take a different route -- see `zipEntries`.
import * as pipeline from 'SRC/lib/pipeline';
import * as resize from 'SRC/lib/resize';
import { extractPalette } from 'SRC/lib/colorExtract';
import { PRESETS } from 'SRC/presets';

// These two are not part of the original tree, so they are always imported from
// the working copy: the plan is the expectation the original is measured
// against, not a thing under test in original mode.
import { planZip, previewOutputs } from 'WORKING/lib/zipPlan';
import { parseIco, parseIcns } from 'TESTS/containers.js';

declare const __ORIGINAL__: boolean;

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Result[] = [];

/*
 * Report a failure to load or a stray rejection into the page, rather than only
 * to a console nothing is reading.
 *
 * Without this, anything that goes wrong before `run()` finishes leaves `#out`
 * saying "running" and the driver reporting "no results block" -- which says
 * nothing about what happened. `stage` is updated as the module progresses so
 * that a hang can be told from a throw.
 */
let stage = 'module evaluated';

function report(text: string): void {
  const out = document.getElementById('out');
  if (out) out.textContent = text;
}

/*
 * Write the results block after every check, not only at the end.
 *
 * The driver dumps the DOM once, when its virtual time budget runs out, and it
 * gets whatever the page says at that moment. Publishing as we go means a check
 * that never settles still leaves behind everything before it and the name of
 * the one it stopped on -- which is the difference between "the harness hung"
 * and "the harness hung in the .icns check". `done` is what tells the driver it
 * is looking at a finished run rather than a snapshot of a stalled one.
 */
function publish(done: boolean): void {
  report(
    `RESULTS_BEGIN${JSON.stringify({
      done,
      stage,
      original: typeof __ORIGINAL__ !== 'undefined' && __ORIGINAL__,
      results,
    })}RESULTS_END`,
  );
}

function fatal(what: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  report(`RESULTS_BEGIN${JSON.stringify({ fatal: `${what} at stage "${stage}": ${detail}`, results })}RESULTS_END`);
}

window.addEventListener('error', (e) => fatal('uncaught error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fatal('unhandled rejection', e.reason));

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  stage = name;
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        results.push({ name, ok: true });
        publish(false);
      },
      (err: unknown) => {
        results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
        publish(false);
      },
    );
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}:\n  expected ${b}\n  actual   ${a}`);
}

// --------------------------------------------------------------- fixtures ---

/**
 * A source image built in the page, as a real decoded `HTMLImageElement`.
 *
 * `paint` draws whatever the check needs. Going through a canvas, a PNG blob and
 * `img.decode()` means the pipeline is handed exactly the kind of object
 * `loadImage` hands it, rather than a canvas standing in for one.
 */
async function sourceImage(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Four quadrants in four flat colours, so a stretch or a swap is visible. */
const quadrants = (ctx: CanvasRenderingContext2D) => {
  const w = ctx.canvas.width / 2;
  const h = ctx.canvas.height / 2;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(w, 0, w, h);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(0, h, w, h);
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(w, h, w, h);
};

const byId = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`no preset ${id}`);
  return preset;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG: bad signature');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
}

/**
 * Build a zip for a selection and return its entries, whichever code path this
 * build has.
 *
 * The working copy has `buildZipBlob`, which hands the blob back. The original
 * had only `exportZip`, whose last act is to give the blob to `file-saver` --
 * and `file-saver` gets its URL from `URL.createObjectURL`, so patching that for
 * the duration of the call captures the blob without the original source needing
 * to change. The anchor click that follows does nothing in headless Chrome.
 */
async function zipEntries(
  source: HTMLImageElement,
  presets: typeof PRESETS,
  colors: string[],
): Promise<{ paths: string[]; zip: JSZip }> {
  let blob: Blob;

  if (typeof (pipeline as Record<string, unknown>).buildZipBlob === 'function') {
    blob = await pipeline.buildZipBlob(source, presets, colors);
  } else {
    const realCreate = URL.createObjectURL.bind(URL);
    let captured: Blob | null = null;
    URL.createObjectURL = ((obj: Blob) => {
      if (obj instanceof Blob && obj.type.includes('zip')) captured = obj;
      return realCreate(obj);
    }) as typeof URL.createObjectURL;
    try {
      await pipeline.exportZip(source, presets, colors, 'capture.zip');
    } finally {
      URL.createObjectURL = realCreate;
    }
    if (!captured) throw new Error('could not capture the zip blob from exportZip');
    blob = captured;
  }

  const zip = await JSZip.loadAsync(blob);
  const paths: string[] = [];
  zip.forEach((path, entry) => {
    if (!entry.dir) paths.push(path);
  });
  return { paths: paths.sort(), zip };
}

// ------------------------------------------------------------- the checks ---

async function run(): Promise<void> {
  const square = await sourceImage(512, 512, quadrants);

  await check('sourceToCanvas keeps the source at its natural size', () => {
    if (typeof resize.sourceToCanvas !== 'function') throw new Error('SKIP: not in this build');
    const canvas = resize.sourceToCanvas(square);
    assertEqual(canvas.width, 512, 'width');
    assertEqual(canvas.height, 512, 'height');
  });

  await check('resizeToCanvas produces an exactly square canvas at each size', async () => {
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(square) : square;
    for (const size of [16, 32, 48, 87, 256, 1024]) {
      const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, size);
      assertEqual(canvas.width, size, `width at ${size}`);
      assertEqual(canvas.height, size, `height at ${size}`);
    }
  });

  await check('canvasToPngBytes returns a PNG whose header matches the canvas', async () => {
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(square) : square;
    for (const size of [16, 128, 256]) {
      const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, size);
      const bytes = await resize.canvasToPngBytes(canvas);
      const header = readPngSize(bytes);
      assertEqual(header.width, size, `IHDR width at ${size}`);
      assertEqual(header.height, size, `IHDR height at ${size}`);
    }
  });

  /*
   * pica resamples rather than using the browser's default scaling, and the
   * quadrant fixture makes that checkable: each corner of the output must still
   * be the colour of the corresponding corner of the input.
   */
  await check('a resize keeps the image the right way up and the right way round', async () => {
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(square) : square;
    const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, 64);
    const ctx = canvas.getContext('2d')!;
    const at = (x: number, y: number) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return `${r > 128 ? 1 : 0}${g > 128 ? 1 : 0}${b > 128 ? 1 : 0}`;
    };
    assertEqual(at(4, 4), '100', 'top left should still be red');
    assertEqual(at(59, 4), '010', 'top right should still be green');
    assertEqual(at(4, 59), '001', 'bottom left should still be blue');
    assertEqual(at(59, 59), '110', 'bottom right should still be yellow');
  });

  /*
   * Documenting, not asserting a preference: a non-square source is stretched to
   * fill the square output. The README says so now. If this ever fails, the
   * behaviour changed and the README is wrong.
   */
  await check('a non-square source is stretched to square, not cropped or padded', async () => {
    // Two halves, left red and right green, in a 4:1 frame. Stretching keeps
    // both halves; cropping to centre would keep the boundary; padding would put
    // transparent rows top and bottom.
    const wide = await sourceImage(400, 100, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 200, 100);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(200, 0, 200, 100);
    });
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(wide) : wide;
    const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, 64);
    const ctx = canvas.getContext('2d')!;
    const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    const redAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0];

    assertEqual(alphaAt(32, 2), 255, 'the top row is opaque, so nothing was letterboxed');
    assertEqual(alphaAt(32, 61), 255, 'the bottom row is opaque, so nothing was letterboxed');
    assert(redAt(4, 32) > 128, 'the left edge is still the red half, so nothing was cropped away');
    assert(redAt(59, 32) < 128, 'the right edge is still the green half');
  });

  // ------------------------------------------------------------- the zip ---

  await check('the zip contains exactly the files the plan names', async () => {
    const presets = [byId('favicon-pwa'), byId('macos-iconset'), byId('windows-ico'), byId('ios')];
    const colors = ['#112233', '#445566'];
    const { paths } = await zipEntries(square, presets, colors);
    const expected = planZip(presets, colors)
      .map((e) => e.path)
      .sort();
    assertDeepEqual(paths, expected, 'zip contents');
  });

  await check('regression: the favicon set contains the loose PNGs its link tags need', async () => {
    const { paths } = await zipEntries(square, [byId('favicon-pwa')], []);
    for (const name of ['favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png']) {
      assert(paths.includes(`web/${name}`), `web/${name} is missing from ${JSON.stringify(paths)}`);
    }
  });

  /*
   * Not a regression: the zip always held all ten. The original deduplicated by
   * size in `generatePreviews` only, so it was the output grid that showed seven
   * of them -- see the preview check below. This one is here because a plan that
   * started dropping duplicate sizes from the archive would be a much worse bug
   * than the one that existed, and nothing else would notice.
   */
  await check('the macOS iconset writes all ten of its named files', async () => {
    const { paths } = await zipEntries(square, [byId('macos-iconset')], []);
    const pngs = paths.filter((p) => p.endsWith('.png'));
    assertEqual(pngs.length, 10, `expected ten PNGs, got ${JSON.stringify(pngs)}`);
    assert(pngs.includes('macos.iconset/icon_32x32.png'), 'icon_32x32.png is missing');
    assert(pngs.includes('macos.iconset/icon_256x256.png'), 'icon_256x256.png is missing');
    assert(pngs.includes('macos.iconset/icon_512x512.png'), 'icon_512x512.png is missing');
  });

  await check('every PNG in the zip is a real PNG at the size its name implies', async () => {
    const presets = [byId('macos-iconset'), byId('android')];
    const { paths, zip } = await zipEntries(square, presets, []);
    const sizeByPath = new Map<string, number>();
    for (const preset of presets) {
      for (const output of preset.outputs) {
        sizeByPath.set(`${preset.folder}/${output.filename}`, output.size);
      }
    }
    for (const path of paths.filter((p) => p.endsWith('.png'))) {
      const bytes = await zip.file(path)!.async('uint8array');
      const header = readPngSize(bytes);
      assertEqual(header.width, sizeByPath.get(path), `${path} width`);
      assertEqual(header.height, sizeByPath.get(path), `${path} height`);
    }
  });

  await check('the .ico in the zip parses and holds its four frames at the right sizes', async () => {
    const { zip } = await zipEntries(square, [byId('windows-ico')], []);
    const bytes = await zip.file('windows/app.ico')!.async('uint8array');
    const ico = parseIco(bytes);
    assertEqual(ico.count, 4, 'frame count');
    assertDeepEqual(ico.entries.map((e) => e.width), [16, 32, 48, 256], 'declared frame sizes');
    assertEqual(ico.slack, 0, 'unreachable bytes');
    for (const entry of ico.entries) {
      const header = readPngSize(entry.data);
      assertEqual(header.width, entry.width, `the ${entry.width}px entry holds a ${header.width}px PNG`);
    }
  });

  await check('the .icns in the zip parses and holds all ten OSTypes', async () => {
    const { zip } = await zipEntries(square, [byId('macos-iconset')], []);
    const bytes = await zip.file('macos.iconset/AppIcon.icns')!.async('uint8array');
    const icns = parseIcns(bytes);
    assertDeepEqual(
      icns.elements.map((e) => e.osType),
      ['icp4', 'ic11', 'icp5', 'ic12', 'ic07', 'ic13', 'ic08', 'ic14', 'ic09', 'ic10'],
      'OSTypes in order',
    );
    const expectedPixels: Record<string, number> = {
      icp4: 16, ic11: 32, icp5: 32, ic12: 64, ic07: 128,
      ic13: 256, ic08: 256, ic14: 512, ic09: 512, ic10: 1024,
    };
    for (const el of icns.elements) {
      const header = readPngSize(el.data);
      assertEqual(header.width, expectedPixels[el.osType], `${el.osType} payload size`);
    }
  });

  await check('regression: the zipped Contents.json is a catalogue Xcode can use', async () => {
    const { zip } = await zipEntries(square, [byId('ios')], []);
    const text = await zip.file('ios/AppIcon.appiconset/Contents.json')!.async('string');
    const contents = JSON.parse(text);
    assert(Array.isArray(contents.images), 'images is an array');
    for (const image of contents.images) {
      assert(image.idiom, `${image.filename} has no idiom`);
      assert(image.scale, `${image.filename} has no scale`);
      const points = Number(String(image.size).split('x')[0]);
      const scale = Number(String(image.scale).replace('x', ''));
      const bytes = await zip.file(`ios/AppIcon.appiconset/${image.filename}`)!.async('uint8array');
      assertEqual(readPngSize(bytes).width, points * scale,
        `${image.filename} is described as ${image.size} at ${image.scale}`);
    }
  });

  await check('the palette files in the zip match the palette passed in', async () => {
    const colors = ['#AABBCC', '#DDEEFF'];
    const { zip } = await zipEntries(square, [byId('android')], colors);
    assertDeepEqual(JSON.parse(await zip.file('colors.json')!.async('string')), colors, 'colors.json');
    const css = await zip.file('colors.css')!.async('string');
    assert(css.includes('--icon-color-1: #AABBCC;'), `colors.css is ${JSON.stringify(css)}`);
    assert(css.includes('--icon-color-2: #DDEEFF;'), `colors.css is ${JSON.stringify(css)}`);
  });

  // -------------------------------------------------------- the previews ---

  await check('regression: previews list one image per file, not one per size', async () => {
    const iconset = byId('macos-iconset');
    const items = await pipeline.generatePreviews(square, [iconset]);
    assertEqual(items.length, iconset.outputs.length,
      'the macOS iconset names ten files across six sizes; the grid must list ten');
    assertDeepEqual(
      items.map((i) => i.filename),
      previewOutputs([iconset]).map((o) => o.filename),
      'preview filenames',
    );
  });

  await check('every preview blob URL resolves to a PNG of the stated size', async () => {
    const items = await pipeline.generatePreviews(square, [byId('browser-extension')]);
    for (const item of items) {
      const bytes = new Uint8Array(await (await fetch(item.blobUrl)).arrayBuffer());
      assertEqual(readPngSize(bytes).width, item.size, `${item.filename} preview size`);
    }
  });

  /*
   * The leak. Previews are regenerated on every change of selection, and each
   * run mints an object URL per distinct size; the original never revoked any of
   * them, so the blobs stayed alive for as long as the page did.
   *
   * What is checkable is the other half of the contract: that revoking actually
   * releases, so the fix in App.svelte has something to call.
   */
  await check('revoking a preview releases its blob', async () => {
    if (typeof (pipeline as Record<string, unknown>).revokePreviews !== 'function') {
      throw new Error('SKIP: revokePreviews is not in this build');
    }
    const items = await pipeline.generatePreviews(square, [byId('vscode-extension')]);
    const url = items[0].blobUrl;
    assert((await fetch(url)).ok, 'the preview should fetch before it is revoked');

    pipeline.revokePreviews(items);
    let stillThere = false;
    try {
      stillThere = (await fetch(url)).ok;
    } catch {
      stillThere = false;
    }
    assert(!stillThere, 'the blob is still reachable after revokePreviews');
  });

  await check('previews share one image between outputs of the same size', async () => {
    // The macOS iconset has ten files across six sizes, so four of the ten must
    // reuse another's image rather than resizing again.
    const items = await pipeline.generatePreviews(square, [byId('macos-iconset')]);
    const distinctUrls = new Set(items.map((i) => i.blobUrl)).size;
    const distinctSizes = new Set(items.map((i) => i.size)).size;
    assertEqual(distinctUrls, distinctSizes, 'one blob per distinct size');
  });

  // --------------------------------------------------------- the palette ---

  /*
   * A tolerance, not an exact match, and the reason is worth writing down
   * because the first version of this check failed and the code was right.
   *
   * `pica` resamples with a Lanczos-style filter, so the quadrant boundaries
   * bleed: a 512px image of four flat colours downscaled to 128px is four flat
   * colours plus a few pixels of everything in between, and the palette comes
   * back as #FE0000 and #01FF00 rather than #FF0000 and #00FF00. Demanding the
   * exact hex asserts that the resampler does not resample.
   *
   * Two units a channel is tight enough that a genuinely wrong colour -- a
   * swapped quadrant, a red/blue transposition, a lost alpha -- is still caught.
   */
  await check('regression: every corner colour survives into the palette', async () => {
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(square) : square;
    const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, 128);
    const palette = extractPalette(canvas, 5);

    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const near = (a: string, b: string) =>
      channels(a).every((v, i) => Math.abs(v - channels(b)[i]) <= 2);

    for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FFFF00']) {
      assert(palette.some((p) => near(p, hex)),
        `nothing within two units of ${hex} in ${JSON.stringify(palette)}`);
    }
  });

  await check('regression: a single-colour image gives a single swatch', async () => {
    const flat = await sourceImage(256, 256, (ctx) => {
      ctx.fillStyle = '#3366cc';
      ctx.fillRect(0, 0, 256, 256);
    });
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(flat) : flat;
    const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, 128);
    const palette = extractPalette(canvas, 5);
    assertDeepEqual(palette, ['#3366CC'], 'palette of a flat fill');
  });

  await check('a transparent source yields no palette rather than a row of black', async () => {
    const empty = await sourceImage(128, 128, () => {});
    const from = resize.sourceToCanvas ? resize.sourceToCanvas(empty) : empty;
    const canvas = await resize.resizeToCanvas(from as HTMLCanvasElement, 128);
    assertDeepEqual(extractPalette(canvas, 5), [], 'palette of a transparent image');
  });

  // --------------------------------------------------------- the big one ---

  /*
   * Everything at once, which is what pressing Download with every platform
   * ticked actually does. Worth its own check because it is the only one that
   * exercises the full size list and the whole plan together, and because it is
   * the slowest thing the app can be asked to do.
   */
  await check('every preset at once produces a zip matching the plan', async () => {
    const colors = ['#101010', '#F0F0F0'];
    const { paths } = await zipEntries(square, PRESETS, colors);
    const expected = planZip(PRESETS, colors).map((e) => e.path).sort();
    assertDeepEqual(paths, expected, 'every-preset zip contents');
    assert(paths.length > 90, `expected a large archive, got ${paths.length} files`);
  });

  stage = 'done';
  publish(true);
}

// Publish once before starting, so that "the module never ran" and "the first
// check never settled" are distinguishable in the dump.
publish(false);

run().catch((err: unknown) => fatal('run() rejected', err));
