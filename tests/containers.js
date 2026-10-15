/*
 * Independent readers for the two container formats, written from the format
 * documentation and not from `src/lib/icoWriter.ts` or `src/lib/icnsWriter.ts`.
 *
 * The point of writing them separately is that the writers' only real validator
 * is an operating system's icon loader, which reports nothing at all when a
 * container is wrong -- the icon simply does not appear. Asserting that
 * `packIco` produced the bytes `packIco` produces would catch nothing. These
 * parsers instead say what the *format* requires, so a disagreement is a real
 * disagreement.
 *
 * They are deliberately strict and deliberately paranoid: every field is
 * checked against the file it appears in rather than against the value the
 * writer would have used. An offset that points past the end of the file, a
 * declared payload length that does not match the bytes actually present, a
 * total-length field that disagrees with the file size -- each is an error
 * here, because each is a file that loads as nothing on the target platform.
 *
 * Endianness is the field most worth being explicit about, because getting it
 * backwards produces a plausible-looking file that does not work:
 *   .ico  -- little-endian throughout (it is a Windows format)
 *   .icns -- big-endian throughout (it is a Macintosh format)
 * The two writers therefore cannot share a helper, and a copy-paste between
 * them is exactly the mistake these readers exist to catch.
 */

function view(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { u8, dv: new DataView(u8.buffer, u8.byteOffset, u8.byteLength) };
}

/*
 * Parses a Windows .ico.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * image payloads. Entry field 0 is the width in pixels with 0 meaning 256,
 * which is the only way the format can express 256 -- a single byte cannot
 * hold it. Fields 8..11 are the payload length and 12..15 its absolute offset
 * from the start of the file, both little-endian.
 */
export function parseIco(bytes) {
  const { u8, dv } = view(bytes);
  if (u8.byteLength < 6) throw new Error(`.ico too short for its directory header: ${u8.byteLength} bytes`);

  const reserved = dv.getUint16(0, true);
  const type = dv.getUint16(2, true);
  const count = dv.getUint16(4, true);
  if (reserved !== 0) throw new Error(`.ico reserved field is ${reserved}, must be 0`);
  if (type !== 1) throw new Error(`.ico type is ${type}, must be 1 (2 would be a .cur)`);

  const dirBytes = 6 + count * 16;
  if (u8.byteLength < dirBytes) {
    throw new Error(`.ico declares ${count} entries, which needs ${dirBytes} bytes of directory, but the file is ${u8.byteLength}`);
  }

  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const rawWidth = u8[at];
    const rawHeight = u8[at + 1];
    const length = dv.getUint32(at + 8, true);
    const offset = dv.getUint32(at + 12, true);

    if (offset < dirBytes) {
      throw new Error(`.ico entry ${i} points at offset ${offset}, inside the ${dirBytes}-byte directory`);
    }
    if (offset + length > u8.byteLength) {
      throw new Error(`.ico entry ${i} claims ${length} bytes at offset ${offset}, past the end of a ${u8.byteLength}-byte file`);
    }

    entries.push({
      width: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      declaredWidthByte: rawWidth,
      declaredHeightByte: rawHeight,
      colourCount: u8[at + 2],
      reserved: u8[at + 3],
      planes: dv.getUint16(at + 4, true),
      bitCount: dv.getUint16(at + 6, true),
      length,
      offset,
      data: u8.subarray(offset, offset + length),
    });
  }

  /*
   * Trailing or interleaved slack is not illegal, but it means the writer put
   * a payload somewhere no entry points at, which is always a bug rather than
   * a choice. Reporting it lets a test assert there is none.
   */
  const accountedFor = entries.reduce((sum, e) => sum + e.length, 0);
  return { count, entries, slack: u8.byteLength - dirBytes - accountedFor, byteLength: u8.byteLength };
}

/*
 * Parses a macOS .icns.
 *
 * Layout: the magic 'icns', a big-endian 32-bit length covering the *whole
 * file including these 8 bytes*, then a sequence of elements. Each element is
 * a 4-character OSType, a big-endian 32-bit length covering the whole element
 * including its own 8-byte header, and then the payload.
 *
 * The length being inclusive in both places is the detail worth a reader of
 * its own: a writer that stores the payload length instead produces a file
 * whose every element boundary is eight bytes early, and walking it gives
 * garbage OSTypes rather than an obvious failure.
 */
export function parseIcns(bytes) {
  const { u8, dv } = view(bytes);
  if (u8.byteLength < 8) throw new Error(`.icns too short for its header: ${u8.byteLength} bytes`);

  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'icns') throw new Error(`.icns magic is ${JSON.stringify(magic)}, must be "icns"`);

  const declaredTotal = dv.getUint32(4, false);
  if (declaredTotal !== u8.byteLength) {
    throw new Error(`.icns header declares ${declaredTotal} bytes, file is ${u8.byteLength}`);
  }

  const elements = [];
  let pos = 8;
  while (pos < u8.byteLength) {
    if (pos + 8 > u8.byteLength) {
      throw new Error(`.icns has ${u8.byteLength - pos} trailing bytes at ${pos}, too few for an element header`);
    }
    const osType = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
    const elementLength = dv.getUint32(pos + 4, false);

    if (elementLength < 8) {
      throw new Error(`.icns element ${JSON.stringify(osType)} at ${pos} declares length ${elementLength}, below its own 8-byte header`);
    }
    if (pos + elementLength > u8.byteLength) {
      throw new Error(`.icns element ${JSON.stringify(osType)} at ${pos} declares ${elementLength} bytes, past the end of a ${u8.byteLength}-byte file`);
    }
    if (!/^[\x20-\x7e]{4}$/.test(osType)) {
      throw new Error(`.icns element at ${pos} has a non-printable OSType: ${JSON.stringify(osType)}`);
    }

    elements.push({
      osType,
      elementLength,
      offset: pos,
      data: u8.subarray(pos + 8, pos + elementLength),
    });
    pos += elementLength;
  }

  return { elements, byteLength: u8.byteLength, declaredTotal };
}
