/*
 * The two binary container writers.
 *
 * These are the highest-value tests in the project and the reason the suite
 * exists: `packIco` and `packIcns` are pure functions whose output is only ever
 * validated by an operating system's icon loader, and that loader reports
 * nothing when a container is malformed. The icon just does not appear.
 *
 * Every assertion here goes through `tests/containers.js`, which parses the two
 * formats from their documentation rather than from the writers, so an
 * agreement between the two is evidence and not a tautology.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packIco } from '../src/lib/icoWriter.ts';
import { packIcns } from '../src/lib/icnsWriter.ts';
import { parseIco, parseIcns } from './containers.js';
import { makePng, readPngHeader } from './pngbuild.js';

const entriesFor = (sizes) => sizes.map((size) => ({ size, png: new Uint8Array(makePng(size)) }));

// ---------------------------------------------------------------- .ico -----

test('ico: the directory header says "one icon file, N images"', () => {
  const ico = parseIco(packIco(entriesFor([16, 32, 48])));
  assert.equal(ico.count, 3);
  assert.equal(ico.entries.length, 3);
});

test('ico: every declared payload length equals the PNG it was given', () => {
  const entries = entriesFor([16, 32, 48, 256]);
  const ico = parseIco(packIco(entries));
  for (const [i, entry] of ico.entries.entries()) {
    assert.equal(entry.length, entries[i].png.byteLength,
      `entry ${i} declares ${entry.length} bytes for a ${entries[i].png.byteLength}-byte PNG`);
  }
});

test('ico: every offset lands on the start of the right PNG, in order', () => {
  const entries = entriesFor([16, 32, 48]);
  const ico = parseIco(packIco(entries));
  for (const [i, entry] of ico.entries.entries()) {
    assert.deepEqual(Array.from(entry.data), Array.from(entries[i].png),
      `entry ${i} payload is not the PNG that was passed in at index ${i}`);
  }
});

test('ico: a round trip returns PNGs that still parse, at the right dimensions', () => {
  const sizes = [16, 32, 48, 256];
  const ico = parseIco(packIco(entriesFor(sizes)));
  for (const [i, entry] of ico.entries.entries()) {
    const header = readPngHeader(entry.data);
    assert.equal(header.width, sizes[i]);
    assert.equal(header.height, sizes[i]);
  }
});

test('ico: the file has no bytes that no entry points at', () => {
  const ico = parseIco(packIco(entriesFor([16, 32, 48, 256])));
  assert.equal(ico.slack, 0, `${ico.slack} bytes of the file are unreachable from the directory`);
});

/*
 * The 256 case is the one the format cannot express directly: the width and
 * height fields are single bytes, so 256 is written as 0 by convention. A
 * writer that stores `256 & 0xff` gets the same answer by accident; one that
 * clamps to 255 produces a file Windows displays at the wrong size.
 */
test('ico: 256px is encoded as the byte 0, which is how the format spells it', () => {
  const ico = parseIco(packIco(entriesFor([256])));
  assert.equal(ico.entries[0].declaredWidthByte, 0);
  assert.equal(ico.entries[0].declaredHeightByte, 0);
  assert.equal(ico.entries[0].width, 256, 'a reader should see 256, not 0');
});

test('ico: sizes below 256 are written literally', () => {
  const ico = parseIco(packIco(entriesFor([16, 32, 48, 128, 255])));
  assert.deepEqual(ico.entries.map((e) => e.declaredWidthByte), [16, 32, 48, 128, 255]);
  assert.deepEqual(ico.entries.map((e) => e.width), [16, 32, 48, 128, 255]);
});

/*
 * Endianness. A 16-byte directory entry read with the wrong byte order gives a
 * length and offset in the tens of millions, so the failure is dramatic -- but
 * only if something reads it. Nothing did before this test.
 */
test('ico: lengths and offsets are little-endian', () => {
  // A payload long enough that its length has distinct high and low bytes.
  const png = new Uint8Array(makePng(256));
  assert.ok(png.byteLength > 0x100, 'fixture must exceed one byte to pin byte order');

  const bytes = packIco([{ size: 256, png }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(14, true), png.byteLength, 'payload length must read correctly little-endian');
  assert.notEqual(dv.getUint32(14, false), png.byteLength, 'and must not also read correctly big-endian');
  assert.equal(dv.getUint32(18, true), 6 + 16, 'the single payload starts right after the directory');
  assert.equal(dv.getUint16(4, true), 1, 'the image count must read correctly little-endian');
});

test('ico: the fixed directory fields are what a PNG-in-ICO entry needs', () => {
  const ico = parseIco(packIco(entriesFor([32])));
  const e = ico.entries[0];
  assert.equal(e.colourCount, 0, 'a 32-bit image has no palette');
  assert.equal(e.reserved, 0);
  assert.equal(e.planes, 1);
  assert.equal(e.bitCount, 32);
});

test('ico: total length is the directory plus every payload, exactly', () => {
  const entries = entriesFor([16, 32, 48, 256]);
  const bytes = packIco(entries);
  const expected = 6 + entries.length * 16 + entries.reduce((n, e) => n + e.png.byteLength, 0);
  assert.equal(bytes.byteLength, expected);
});

/*
 * What the writers refuse.
 *
 * Each of these used to produce a file rather than an error, and each of those
 * files loads as nothing on Windows with no message -- which is the failure mode
 * this whole suite exists because of.
 */
test('ico: refuses a frame larger than one byte can describe', () => {
  const png = new Uint8Array(makePng(16));
  assert.throws(() => packIco([{ size: 512, png }]), /512px cannot be described/);
  assert.throws(() => packIco([{ size: 257, png }]), /257px cannot be described/);
});

test('ico: 512 is not silently written as 256', () => {
  // The original masked the size to a byte, so 512 became 0, which a reader
  // takes to mean 256. The file then claimed a 256px frame and held a 512px one.
  const png = new Uint8Array(makePng(512));
  assert.throws(() => packIco([{ size: 512, png }]));
});

test('ico: refuses an empty image list', () => {
  assert.throws(() => packIco([]), /at least one image/);
});

test('ico: refuses a fractional or zero size', () => {
  const png = new Uint8Array(makePng(16));
  assert.throws(() => packIco([{ size: 16.5, png }]));
  assert.throws(() => packIco([{ size: 0, png }]));
  assert.throws(() => packIco([{ size: -16, png }]));
});

// --------------------------------------------------------------- .icns -----

const icnsEntriesFor = (pairs) =>
  pairs.map(([osType, size]) => ({ osType, png: new Uint8Array(makePng(size)) }));

test('icns: the header is the magic and the whole file length, big-endian', () => {
  const bytes = packIcns(icnsEntriesFor([['icp4', 16], ['ic11', 32]]));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'icns');
  assert.equal(dv.getUint32(4, false), bytes.byteLength, 'must read correctly big-endian');
  assert.notEqual(dv.getUint32(4, true), bytes.byteLength, 'and must not also read correctly little-endian');
});

test('icns: each element length includes its own 8-byte header', () => {
  const entries = icnsEntriesFor([['icp4', 16], ['icp5', 32], ['ic07', 128]]);
  const icns = parseIcns(packIcns(entries));
  for (const [i, el] of icns.elements.entries()) {
    assert.equal(el.elementLength, 8 + entries[i].png.byteLength,
      `${el.osType} declares ${el.elementLength} for an 8 + ${entries[i].png.byteLength} element`);
  }
});

test('icns: element lengths are big-endian', () => {
  const png = new Uint8Array(makePng(256));
  const bytes = packIcns([{ osType: 'ic08', png }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(12, false), 8 + png.byteLength, 'must read correctly big-endian');
  assert.notEqual(dv.getUint32(12, true), 8 + png.byteLength, 'and must not also read correctly little-endian');
});

test('icns: the OSTypes come out in the order they went in', () => {
  const pairs = [['icp4', 16], ['ic11', 32], ['icp5', 32], ['ic12', 64], ['ic07', 128]];
  const icns = parseIcns(packIcns(icnsEntriesFor(pairs)));
  assert.deepEqual(icns.elements.map((e) => e.osType), pairs.map(([t]) => t));
});

test('icns: a round trip returns each PNG byte for byte', () => {
  const entries = icnsEntriesFor([['icp4', 16], ['ic11', 32], ['ic10', 1024]]);
  const icns = parseIcns(packIcns(entries));
  for (const [i, el] of icns.elements.entries()) {
    assert.deepEqual(Array.from(el.data), Array.from(entries[i].png), `${el.osType} payload differs`);
  }
});

test('icns: a round trip returns PNGs that still parse at the right size', () => {
  const pairs = [['icp4', 16], ['ic11', 32], ['ic07', 128], ['ic08', 256], ['ic10', 1024]];
  const icns = parseIcns(packIcns(icnsEntriesFor(pairs)));
  for (const [i, el] of icns.elements.entries()) {
    const header = readPngHeader(el.data);
    assert.equal(header.width, pairs[i][1], `${el.osType} holds a ${header.width}px PNG`);
  }
});

test('icns: two elements may hold the same size under different OSTypes', () => {
  // 128x128@2x and 256x256 are both 256 pixels; a real .iconset contains both.
  const png = new Uint8Array(makePng(256));
  const icns = parseIcns(packIcns([{ osType: 'ic13', png }, { osType: 'ic08', png }]));
  assert.deepEqual(icns.elements.map((e) => e.osType), ['ic13', 'ic08']);
  assert.deepEqual(Array.from(icns.elements[0].data), Array.from(icns.elements[1].data));
});

test('icns: total length is 8 plus every element, exactly', () => {
  const entries = icnsEntriesFor([['icp4', 16], ['ic11', 32], ['ic07', 128]]);
  const bytes = packIcns(entries);
  const expected = 8 + entries.reduce((n, e) => n + 8 + e.png.byteLength, 0);
  assert.equal(bytes.byteLength, expected);
});

/*
 * An OSType is copied into the file one character at a time, so anything that
 * is not four ASCII characters was written as something else and skipped by
 * macOS in silence. A three-character string left `charCodeAt(3)` returning NaN,
 * which stores as zero.
 */
test('icns: refuses an OSType that is not four ASCII characters', () => {
  const png = new Uint8Array(makePng(16));
  for (const osType of ['ic7', 'ic0777', '', 'icé7', 'icあ7']) {
    assert.throws(() => packIcns([{ osType, png }]), /OSType/,
      `${JSON.stringify(osType)} should be refused`);
  }
});

test('icns: a three-character OSType is not silently NUL-padded', () => {
  const png = new Uint8Array(makePng(16));
  assert.throws(() => packIcns([{ osType: 'ic7', png }]));
});

test('icns: refuses an empty element list', () => {
  assert.throws(() => packIcns([]), /at least one element/);
});

/*
 * The two formats' opposite byte orders in one assertion. If a future change
 * factors a shared length-writing helper out of the two writers, this is the
 * test that notices.
 */
test('the two formats disagree about byte order, and both writers know it', () => {
  const png = new Uint8Array(makePng(256));
  const ico = packIco([{ size: 256, png }]);
  const icns = packIcns([{ osType: 'ic08', png }]);

  const icoDv = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  const icnsDv = new DataView(icns.buffer, icns.byteOffset, icns.byteLength);

  assert.equal(icoDv.getUint32(14, true), png.byteLength, '.ico payload length is little-endian');
  assert.equal(icnsDv.getUint32(12, false), 8 + png.byteLength, '.icns element length is big-endian');
});
