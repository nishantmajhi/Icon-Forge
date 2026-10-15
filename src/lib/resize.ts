import Pica from 'pica';

const pica = new Pica();

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // keep the object url alive until decode resolves; revoke after
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Draw the source image onto a canvas once.
 *
 * `resizeToCanvas` used to do this itself, which meant the full-size source was
 * re-allocated and re-drawn for every output size. Selecting every platform
 * asks for about twenty distinct sizes, so a 4000 x 4000 source was 64 MB of
 * canvas allocated and thrown away twenty times over -- and the intermediate
 * that `pica` needs on top of it. Hoisting it out is why the caller now holds
 * the canvas and passes it in.
 */
export function sourceToCanvas(source: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Resize a prepared source canvas to an exact square size, returning a canvas.
 *
 * Note that the result is square whatever the source's aspect ratio: a
 * non-square source is stretched to fit, not cropped or letterboxed. That is
 * how it has always behaved and the README now says so.
 */
export async function resizeToCanvas(from: HTMLCanvasElement, size: number): Promise<HTMLCanvasElement> {
  const to = document.createElement('canvas');
  to.width = size;
  to.height = size;

  // pica gives much better downscale quality than a plain drawImage
  await pica.resize(from, to, { quality: 3 });
  return to;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return canvasToPngBlob(canvas).then((blob) => blob.arrayBuffer()).then((buf) => new Uint8Array(buf));
}
