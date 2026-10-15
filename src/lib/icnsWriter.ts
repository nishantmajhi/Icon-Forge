/**
 * Modern macOS .icns files can embed PNG data directly for every icon
 * size (supported since OS X Lion), so - just like .ico - packing one is
 * a small binary container: an 8-byte file header followed by one
 * "icon element" per size (4-char OSType + 4-byte length + PNG bytes).
 * No native encoder, no WASM, and no `iconutil` / Mac required.
 */
export interface IcnsEntry {
  /** 4-character Apple OSType for this icon size, e.g. 'ic07' for 128x128 */
  osType: string;
  png: Uint8Array;
}

export function packIcns(entries: IcnsEntry[]): Uint8Array {
  /*
   * An OSType is exactly four characters and they have to be ASCII, because
   * they are copied into the file a byte at a time. A shorter string left
   * `charCodeAt` returning NaN, which stores as 0 -- so `'ic7'` silently became
   * the OSType `ic7\0`, which matches nothing, and macOS skipped that element
   * without a word. A non-ASCII character was truncated to its low byte the
   * same way.
   */
  if (entries.length === 0) throw new Error('packIcns: an .icns must contain at least one element');
  for (const { osType } of entries) {
    if (!/^[\x20-\x7e]{4}$/.test(osType)) {
      throw new Error(`packIcns: ${JSON.stringify(osType)} is not a 4-character ASCII OSType`);
    }
  }

  const elements = entries.map(({ osType, png }) => {
    const element = new Uint8Array(8 + png.byteLength);
    for (let i = 0; i < 4; i++) element[i] = osType.charCodeAt(i);
    new DataView(element.buffer).setUint32(4, element.byteLength, false); // big-endian, per spec
    element.set(png, 8);
    return element;
  });

  const bodyLength = elements.reduce((sum, el) => sum + el.byteLength, 0);
  const total = new Uint8Array(8 + bodyLength);
  const header = new DataView(total.buffer);
  total.set([0x69, 0x63, 0x6e, 0x73], 0); // 'icns' magic
  header.setUint32(4, total.byteLength, false);

  let pos = 8;
  for (const el of elements) {
    total.set(el, pos);
    pos += el.byteLength;
  }

  return total;
}
