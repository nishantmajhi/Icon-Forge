/*
 * Builds real PNG files byte by byte, from the specification rather than from
 * anything in `src/`.
 *
 * The writers under test take PNG bytes and copy them into a container. A
 * fixture of random bytes would exercise the copying just as well -- but it
 * would not catch a container whose offsets are right and whose *payloads* are
 * truncated, because nothing downstream would ever notice. A real PNG can be
 * parsed back out of the container and its IHDR checked, so a round trip
 * proves the bytes arrived intact and in the right order, not merely that the
 * lengths add up.
 *
 * It also matters that these are distinguishable. Every fixture here encodes
 * its declared size in its IHDR, so a container that packs the 32px frame
 * where the 16px frame belongs fails an assertion rather than passing quietly.
 *
 * PNG is a much easier format to write than GIF: an 8-byte signature, then
 * length/type/data/CRC chunks. IDAT holds zlib-compressed scanlines, each
 * prefixed with a filter byte, and `node:zlib` does the compression, so
 * nothing here has to agree with an inflater that is also under test.
 */


import { deflateSync } from 'node:zlib';

export const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* PNG's CRC-32 is the standard one; the table is built once on first use. */
let crcTable = null;
export function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/*
 * A colour that is unique per size, so two fixtures of different sizes are
 * never byte-identical -- a container that swapped two frames would otherwise
 * pass a round trip.
 *
 * It has to be a mixing hash rather than anything linear in `size`: the sizes
 * this project uses include 256, 512 and 1024, and any multiple of the size
 * that is then masked to a byte gives all three of those the same colour.
 */
function colourForSize(size) {
  let h = (size * 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (h * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, 0xff];
}

/*
 * An RGBA PNG of the given size, filled with one colour.
 *
 * The colour defaults to something derived from the size, so two fixtures of
 * different sizes never happen to be byte-identical -- which would let a
 * container that swapped two frames pass a round trip.
 */
export function makePng(size, rgba) {
  const [r, g, b, a] = rgba ?? colourForSize(size);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) then `size` RGBA pixels, per scanline.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/*
 * Reads a PNG's signature and IHDR back. Used to prove that the bytes pulled
 * out of a container at a claimed offset really are the frame that was put in.
 */
export function readPngHeader(bytes) {
  const buf = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
  if (buf.length < 33) throw new Error(`too short to be a PNG: ${buf.length} bytes`);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG: bad signature');
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error('not a PNG: first chunk is not IHDR');

  // The IEND chunk is the last 12 bytes of a well-formed PNG. Checking for it
  // is what catches a container that copied a frame one byte short.
  const tail = buf.subarray(buf.length - 12);
  if (tail.subarray(4, 8).toString('latin1') !== 'IEND') throw new Error('PNG is truncated: no IEND at the end');

  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
    byteLength: buf.length,
  };
}

