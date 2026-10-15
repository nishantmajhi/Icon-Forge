/*
 * What the zip will contain, decided before anything is resized or zipped.
 *
 * This was tangled into `exportZip`, which meant the only way to find out what
 * a selection produces was to run a canvas, a resampler and JSZip and then
 * unpack the result. Every mistake that matters here is a wrong path or a
 * missing file, and neither needs any of that to check.
 *
 * Splitting it out also settled a disagreement nobody had noticed: the preview
 * grid and the zip did not contain the same files. See the note on `icoGroup`
 * below.
 */

import type { Preset } from '../presets';

export type PlanEntry =
  /** A single resized PNG. */
  | { kind: 'png'; path: string; size: number }
  /** A Windows .ico packing several sizes. */
  | { kind: 'ico'; path: string; frames: number[] }
  /** A macOS .icns packing several sizes, each under its Apple OSType. */
  | { kind: 'icns'; path: string; frames: { osType: string; size: number }[] }
  /** A generated text file -- Contents.json, site.webmanifest, the palette. */
  | { kind: 'text'; path: string; content: string };

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/**
 * Every file a selection produces, in the order it is written.
 *
 * `colors` is passed through to each preset's `extraFiles`, and is also what
 * decides whether the two palette files at the root appear at all.
 */
export function planZip(presets: Preset[], colors: string[]): PlanEntry[] {
  const entries: PlanEntry[] = [];

  for (const preset of presets) {
    const icoGroups = new Map<string, number[]>();
    const icnsGroups = new Map<string, { osType: string; size: number }[]>();

    for (const output of preset.outputs) {
      /*
       * The loose PNG is always written, including for outputs that are also
       * packed into an .ico.
       *
       * The original skipped it for those, which made two presets promise files
       * they did not deliver: the output grid lists every output by name, so
       * "Favicon / PWA set" showed `favicon-16x16.png`, `favicon-32x32.png` and
       * `favicon-48x48.png` and the zip contained none of them -- and those are
       * the exact filenames every favicon guide's `<link rel="icon">` tags point
       * at, so following one produced three 404s.
       *
       * `icnsGroup`, two lines away in the same interface, already documented
       * this behaviour for itself ("loose png is still written"). Doing the same
       * for `icoGroup` makes the grid honest and takes nothing away.
       */
      entries.push({ kind: 'png', path: join(preset.folder, output.filename), size: output.size });

      if (output.icoGroup) {
        const frames = icoGroups.get(output.icoGroup) ?? [];
        frames.push(output.size);
        icoGroups.set(output.icoGroup, frames);
      }

      if (output.icnsGroup && output.icnsType) {
        const frames = icnsGroups.get(output.icnsGroup) ?? [];
        frames.push({ osType: output.icnsType, size: output.size });
        icnsGroups.set(output.icnsGroup, frames);
      }
    }

    for (const [name, frames] of icoGroups) {
      entries.push({ kind: 'ico', path: join(preset.folder, name), frames });
    }
    for (const [name, frames] of icnsGroups) {
      entries.push({ kind: 'icns', path: join(preset.folder, name), frames });
    }

    if (preset.extraFiles) {
      for (const file of preset.extraFiles(colors)) {
        entries.push({ kind: 'text', path: join(preset.folder, file.name), content: file.content });
      }
    }
  }

  // The extracted palette, as a reference at the root of the zip.
  if (colors.length) {
    const css = `:root {\n${colors.map((c, i) => `  --icon-color-${i + 1}: ${c};`).join('\n')}\n}\n`;
    entries.push({ kind: 'text', path: 'colors.css', content: css });
    entries.push({ kind: 'text', path: 'colors.json', content: JSON.stringify(colors, null, 2) });
  }

  return entries;
}

/**
 * The distinct pixel sizes a plan needs, smallest first.
 *
 * This is what makes resizing happen once per size rather than once per file:
 * the macOS iconset names ten files across six distinct sizes, and an .ico
 * frame is always a size some loose PNG already needed.
 */
export function sizesRequired(plan: PlanEntry[]): number[] {
  const sizes = new Set<number>();
  for (const entry of plan) {
    if (entry.kind === 'png') sizes.add(entry.size);
    else if (entry.kind === 'ico') for (const size of entry.frames) sizes.add(size);
    else if (entry.kind === 'icns') for (const frame of entry.frames) sizes.add(frame.size);
  }
  return [...sizes].sort((a, b) => a - b);
}

/**
 * The images the output grid shows: one per PNG a preset produces.
 *
 * The original deduplicated these by size, which is right for the resizing and
 * wrong for the listing -- the macOS iconset has ten files across six sizes, so
 * the grid showed six of them and captioned the group "6 files". Four of its
 * outputs, `icon_32x32.png` among them, were never listed at all.
 */
export function previewOutputs(presets: Preset[]): { presetId: string; filename: string; size: number }[] {
  const items: { presetId: string; filename: string; size: number }[] = [];
  for (const preset of presets) {
    for (const output of preset.outputs) {
      items.push({ presetId: preset.id, filename: output.filename, size: output.size });
    }
  }
  return items;
}
