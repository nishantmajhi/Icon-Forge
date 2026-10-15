import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Preset } from '../presets';
import { sourceToCanvas, resizeToCanvas, canvasToPngBytes, canvasToPngBlob } from './resize';
import { packIco } from './icoWriter';
import { packIcns } from './icnsWriter';
import { planZip, sizesRequired, previewOutputs } from './zipPlan';

export interface PreviewItem {
  presetId: string;
  filename: string;
  size: number;
  blobUrl: string;
}

/**
 * Release the object URLs behind a set of previews.
 *
 * The caller has to do this, and the original never did: previews are
 * regenerated on every change of selection, and each run minted one object URL
 * per image and dropped the previous run's on the floor. A blob URL keeps its
 * blob alive until it is revoked or the document goes away, so toggling a few
 * platforms back and forth retained every PNG ever previewed.
 */
export function revokePreviews(items: PreviewItem[]): void {
  for (const item of items) URL.revokeObjectURL(item.blobUrl);
}

/**
 * Generate previews -- one per file the selected presets produce.
 *
 * Resizing is cached by pixel size, which is the deduplication the original was
 * reaching for. It applied that dedupe to the returned list as well, so a preset
 * naming ten files across six sizes was previewed as six.
 */
export async function generatePreviews(
  source: HTMLImageElement,
  presets: Preset[]
): Promise<PreviewItem[]> {
  const from = sourceToCanvas(source);
  const urlBySize = new Map<number, string>();

  const items: PreviewItem[] = [];
  for (const output of previewOutputs(presets)) {
    let blobUrl = urlBySize.get(output.size);
    if (blobUrl === undefined) {
      const canvas = await resizeToCanvas(from, output.size);
      blobUrl = URL.createObjectURL(await canvasToPngBlob(canvas));
      urlBySize.set(output.size, blobUrl);
    }
    items.push({ presetId: output.presetId, filename: output.filename, size: output.size, blobUrl });
  }
  return items;
}

/**
 * Build the zip and return it, without saving it anywhere.
 *
 * Separate from `exportZip` so that what goes into the archive can be asserted
 * on: `tests/browser/run.js` calls this, reads the result back with JSZip and
 * compares the entry list against `planZip`. Nothing can do that to a function
 * whose last statement hands a blob to the browser's download machinery.
 */
export async function buildZipBlob(
  source: HTMLImageElement,
  presets: Preset[],
  colors: string[]
): Promise<Blob> {
  const plan = planZip(presets, colors);
  const from = sourceToCanvas(source);

  // Resize once per distinct size, before anything is written.
  const pngBySize = new Map<number, Uint8Array>();
  for (const size of sizesRequired(plan)) {
    pngBySize.set(size, await canvasToPngBytes(await resizeToCanvas(from, size)));
  }
  const pngFor = (size: number) => {
    const png = pngBySize.get(size);
    if (!png) throw new Error(`no ${size}px image was rendered for this plan`);
    return png;
  };

  const zip = new JSZip();
  for (const entry of plan) {
    switch (entry.kind) {
      case 'png':
        zip.file(entry.path, pngFor(entry.size));
        break;
      case 'ico':
        zip.file(entry.path, packIco(entry.frames.map((size) => ({ size, png: pngFor(size) }))));
        break;
      case 'icns':
        zip.file(
          entry.path,
          packIcns(entry.frames.map(({ osType, size }) => ({ osType, png: pngFor(size) })))
        );
        break;
      case 'text':
        zip.file(entry.path, entry.content);
        break;
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

/** Build the zip and hand it to the browser to download. */
export async function exportZip(
  source: HTMLImageElement,
  presets: Preset[],
  colors: string[],
  zipFilename = 'icons.zip'
) {
  saveAs(await buildZipBlob(source, presets, colors), zipFilename);
}
