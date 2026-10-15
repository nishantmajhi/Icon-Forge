/**
 * Windows .ico files can embed PNG data directly (supported since Vista),
 * so packing several sizes into one .ico is just a small binary header -
 * no native encoder or WASM needed.
 */
export function packIco(
  entries: { size: number; png: Uint8Array }[],
): Uint8Array {
  const count = entries.length;

  /*
   * Two things the format cannot express, both of which used to be written
   * anyway and produce a file that loads as nothing.
   *
   * An .ico with no images is six bytes of header. Windows shows no icon and
   * says nothing, so a caller that filtered its list down to empty gets a
   * plausible file rather than an error.
   *
   * And the width and height are one byte each. 256 is spelled 0 by
   * convention, and there is no convention for 257 or more -- the original
   * wrote 0 for those too, so a 512px frame became a file claiming to hold a
   * 256px image and holding something else.
   */
  if (count === 0) throw new Error('packIco: an .ico must contain at least one image');
  if (count > 0xffff) throw new Error(`packIco: ${count} images exceeds the 65535 an .ico can index`);
  for (const { size } of entries) {
    if (!Number.isInteger(size) || size < 1 || size > 256) {
      throw new Error(`packIco: ${size}px cannot be described by an .ico directory entry (1-256 only)`);
    }
  }

  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const dirEntries: Uint8Array[] = [];
  const imageDatas: Uint8Array[] = [];

  for (const { size, png } of entries) {
    const dir = new DataView(new ArrayBuffer(16));
    dir.setUint8(0, size === 256 ? 0 : size); // 0 means 256px
    dir.setUint8(1, size === 256 ? 0 : size);
    dir.setUint8(2, 0); // color palette
    dir.setUint8(3, 0); // reserved
    dir.setUint16(4, 1, true); // color planes
    dir.setUint16(6, 32, true); // bits per pixel
    dir.setUint32(8, png.byteLength, true);
    dir.setUint32(12, offset, true);
    dirEntries.push(new Uint8Array(dir.buffer));

    imageDatas.push(png);
    offset += png.byteLength;
  }

  const header = new DataView(new ArrayBuffer(6));
  header.setUint16(0, 0, true); // reserved
  header.setUint16(2, 1, true); // type: 1 = icon
  header.setUint16(4, count, true);

  const total = new Uint8Array(offset);
  total.set(new Uint8Array(header.buffer), 0);
  let pos = 6;
  for (const d of dirEntries) {
    total.set(d, pos);
    pos += 16;
  }
  for (const img of imageDatas) {
    total.set(img, pos);
    pos += img.byteLength;
  }

  return total;
}
