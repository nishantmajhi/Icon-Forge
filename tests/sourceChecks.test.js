/*
 * The decisions about a source image: refuse it, warn about it, or accept it.
 *
 * The refusal is new -- the original attempted whatever it was given, and a
 * 10,000 x 10,000 PNG allocated a 400 MB canvas per output size until the tab
 * was killed. A killed tab reports nothing, so the only symptom was the page
 * disappearing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkSourceLimits,
  checkResolutionWarning,
  largestRequestedSize,
  isPngFile,
  MAX_SOURCE_SIDE,
  MAX_SOURCE_PIXELS,
} from '../src/lib/sourceChecks.ts';
import { PRESETS } from '../src/presets.ts';

const byId = (id) => PRESETS.find((p) => p.id === id);

// --------------------------------------------------------------- the limits --

test('an ordinary icon source is accepted', () => {
  assert.equal(checkSourceLimits({ width: 1024, height: 1024 }), null);
  assert.equal(checkSourceLimits({ width: 512, height: 512 }), null);
  assert.equal(checkSourceLimits({ width: 4096, height: 2048 }), null);
});

test('exactly at the side limit is accepted', () => {
  // 8192 x 4096 is 32 megapixels, so it is at both limits at once.
  assert.equal(checkSourceLimits({ width: MAX_SOURCE_SIDE, height: 4096 }), null);
});

test('one pixel over the side limit is refused, and the message says both numbers', () => {
  const refusal = checkSourceLimits({ width: MAX_SOURCE_SIDE + 1, height: 100 });
  assert.ok(refusal, 'should be refused');
  assert.match(refusal, /8193/, 'the message should name the size given');
  assert.match(refusal, new RegExp(String(MAX_SOURCE_SIDE)), 'and the limit');
});

test('the side limit applies to height as well as width', () => {
  assert.ok(checkSourceLimits({ width: 100, height: MAX_SOURCE_SIDE + 1 }));
});

/*
 * The megapixel cap exists for the shapes a per-side cap lets through. 8000 is
 * under the side limit, and 8000 x 8000 is 61 megapixels -- a quarter of a
 * gigabyte of canvas.
 */
test('a shape under the side limit can still be refused on total pixels', () => {
  const refusal = checkSourceLimits({ width: 8000, height: 8000 });
  assert.ok(refusal, '8000 x 8000 is 61 megapixels and should be refused');
  assert.match(refusal, /megapixel/i);
});

test('the ten-thousand-square case the review named is refused', () => {
  assert.ok(checkSourceLimits({ width: 10000, height: 10000 }));
});

test('exactly at the megapixel cap is accepted, and one row over is not', () => {
  // 8192 x 4096 is exactly the cap, and also exactly at the side limit.
  const width = MAX_SOURCE_SIDE;
  const height = MAX_SOURCE_PIXELS / MAX_SOURCE_SIDE;
  assert.ok(Number.isInteger(height), 'the two limits should divide evenly for this test to be exact');

  assert.equal(checkSourceLimits({ width, height }), null, `${width}x${height} is exactly the cap`);

  const over = checkSourceLimits({ width, height: height + 1 });
  assert.ok(over, `${width}x${height + 1} is one row past the cap`);
  assert.match(over, /megapixel/i);
});

test('a degenerate or unreported size is refused rather than attempted', () => {
  for (const dims of [
    { width: 0, height: 100 },
    { width: 100, height: 0 },
    { width: -10, height: 10 },
    { width: NaN, height: 100 },
    { width: Infinity, height: 100 },
  ]) {
    assert.ok(checkSourceLimits(dims), `${JSON.stringify(dims)} should be refused`);
  }
});

// ------------------------------------------------------------- the warning ---

test('a source smaller than the largest output warns about upscaling', () => {
  const warning = checkResolutionWarning({ width: 256, height: 256 }, 1024);
  assert.ok(warning);
  assert.match(warning, /256/);
  assert.match(warning, /1024/);
  assert.match(warning, /upscal/i);
});

test('a source at or above the largest output does not warn', () => {
  assert.equal(checkResolutionWarning({ width: 1024, height: 1024 }, 1024), null);
  assert.equal(checkResolutionWarning({ width: 2048, height: 2048 }, 1024), null);
});

test('the warning is about the shorter side, because that is what limits it', () => {
  // 2000 wide but only 100 tall cannot make a clean 256px square.
  assert.ok(checkResolutionWarning({ width: 2000, height: 100 }, 256));
  assert.equal(checkResolutionWarning({ width: 100, height: 2000 }, 64), null);
});

// -------------------------------------------------------- largest requested --

test('the largest requested size is the largest output of any selected preset', () => {
  assert.equal(largestRequestedSize([byId('browser-extension')]), 128);
  assert.equal(largestRequestedSize([byId('macos-iconset')]), 1024);
  assert.equal(largestRequestedSize([byId('browser-extension'), byId('electron')]), 1024);
});

/*
 * The original computed this with `Math.max(...presets.flatMap(...))`, which for
 * an empty selection is -Infinity. It was guarded by an early return, so it
 * never showed -- but the guard and the arithmetic were in different places, and
 * a warning reading "smaller than the largest requested size (-Infinitypx)" is
 * one edit away.
 */
test('an empty selection asks for nothing rather than negative infinity', () => {
  assert.equal(largestRequestedSize([]), 0);
  assert.equal(checkResolutionWarning({ width: 16, height: 16 }, largestRequestedSize([])), null);
});

// ------------------------------------------------------------- the type gate --

test('the type gate accepts a PNG and nothing else', () => {
  assert.equal(isPngFile({ type: 'image/png' }), true);
  for (const type of ['image/jpeg', 'image/webp', 'image/svg+xml', 'application/octet-stream', '']) {
    assert.equal(isPngFile({ type }), false, `${type || '(empty)'} should not be accepted`);
  }
});
