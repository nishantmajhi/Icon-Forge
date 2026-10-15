/*
 * Write a .ico from the project's own writer, for `ico-check.ps1` to hand to
 * Windows.
 *
 * A separate file in the project rather than a heredoc the PowerShell script
 * writes into a temp directory: the imports below are relative, and a script
 * living in the system temp directory resolves them against that directory
 * instead of against `src/`.
 *
 *   node --import ./tests/ts-resolve.mjs tests/platform/emit-containers.mjs <app.ico> <favicon.ico>
 *
 * Prints, on stdout, the colour each fixture size was filled with, as JSON, so
 * the caller can check that the frame Windows hands back is the frame that went
 * in and not merely one of the right size.
 */
import { writeFileSync } from 'node:fs';

import { packIco } from '../../src/lib/icoWriter.ts';
import { makePng } from '../pngbuild.js';

const [appIco, faviconIco] = process.argv.slice(2);
if (!appIco || !faviconIco) {
  console.error('usage: emit-containers.mjs <app.ico> <favicon.ico>');
  process.exit(2);
}

const frame = (size) => ({ size, png: new Uint8Array(makePng(size)) });

// The two .ico files the presets actually produce: the four-frame Windows one
// and the three-frame favicon.
writeFileSync(appIco, packIco([frame(16), frame(32), frame(48), frame(256)]));
writeFileSync(faviconIco, packIco([frame(16), frame(32), frame(48)]));

/* Mirrors `colourForSize` in pngbuild.js. */
const colourForSize = (size) => {
  let h = (size * 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (h * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff];
};

console.log(JSON.stringify(Object.fromEntries([16, 32, 48, 256].map((s) => [s, colourForSize(s)]))));
