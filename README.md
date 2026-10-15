# Icon Forge

Drop in one PNG, get back a zip of every icon a set of platforms asks for —
resized, named the way each platform expects, and packed into real `.ico` and
`.icns` container files. Nothing leaves the browser: there is no server, and the
only network request the app makes is for its own JavaScript.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files into dist/
```

## Why this can work without a server

Resizing in a browser is easy. The reason icon generators are usually
server-side is the two container formats, and both turn out to be simpler than
their reputation:

- **`.ico`** has embedded PNG frames as of Windows Vista. A `.ico` is a six-byte
  header, one sixteen-byte directory entry per frame, and then the PNG bytes.
- **`.icns`** has accepted embedded PNG for every size since OS X Lion. It is an
  eight-byte header followed by one element per size: a four-character Apple
  OSType, a length, and the PNG bytes.

So neither needs a native encoder, a WASM build, or a Mac. `src/lib/icoWriter.ts`
and `src/lib/icnsWriter.ts` are about fifty lines each, and between them they are
the reason the whole thing is a static page.

The catch is that a malformed container has no error message. Windows and macOS
both respond to a bad icon file by showing no icon, which is why those two files
have more tests than anything else here — including, on Windows, a check that
loads the generated `.ico` through the operating system's own decoder.

## What comes out

One folder per selected platform, plus the palette at the root:

```
web/            favicon.ico, favicon-16x16.png … , apple-touch-icon.png, site.webmanifest
windows/        app.ico, frame-16.png …
macos.iconset/  AppIcon.icns, icon_16x16.png, icon_16x16@2x.png …
ios/AppIcon.appiconset/
                Contents.json, icon-20@2x.png …
android/        mipmap-mdpi/ic_launcher.png … , play-store-icon.png
colors.css      :root { --icon-color-1: #…; }
colors.json     ["#…", …]
```

Every PNG named in the output grid is in the zip, and the containers are written
alongside the frames they pack rather than instead of them — a favicon set needs
both `favicon.ico` and the loose `favicon-32x32.png` that a `<link rel="icon">`
tag points at.

`src/presets.ts` is the whole platform table. Adding a platform means adding an
entry there; nothing else needs to change. An output can be marked with an
`icoGroup` or an `icnsGroup` to say which container it should also be packed
into.

## Things worth knowing before you use the output

**A non-square source is stretched, not cropped or letterboxed.** Every icon
format here wants a square, and a 16:9 image becomes a square by being squashed.
Crop it yourself first if that matters.

**A source with no alpha gives icons with no alpha.** `.ico` and `.icns` both
support transparency, but nothing here invents it, so an opaque white background
stays an opaque white background at every size.

**The iOS set is iPhone-only.** The eight device slots plus the App Store
marketing icon. It has no iPad sizes (76pt, 83.5pt) and no 1x slots, which no
current iPhone needs. `Contents.json` describes each image by idiom, point size
and scale, which is what Xcode reads — an asset catalogue that gives only pixel
sizes compiles without complaint and assigns no icon.

**Sources are capped at 8192px a side and 32 megapixels.** Resizing allocates a
canvas the full size of the source, so a 10,000 × 10,000 PNG is 400 MB before any
work starts. Anything larger is refused with a message rather than attempted.

**Below that cap, a source smaller than the largest requested icon is allowed**
and warned about. The outputs will be upscaled and soft.

## How the palette is extracted

`src/lib/colorExtract.ts`, by median cut:

1. Sample the opaque pixels on an evenly spaced grid, up to about 20,000 of
   them. Anything with an alpha below 128 is skipped entirely rather than
   blended toward white.
2. Put every sample in one box. Repeatedly take the box whose widest colour
   channel spans the greatest range and split it at the median of that channel,
   until there are as many boxes as colours wanted or no box can be split.
3. Average each box, merge boxes that averaged to the same colour, and order
   what is left by how many pixels it accounts for. Most dominant first.

It can return fewer colours than asked for, and does: an image of two flat
colours has a palette of two, not five copies of them. It can also return a
colour that appears nowhere in the image, when a box straddles the boundary
between two — that is inherent to median cut, and the alternative is k-means,
which is slower and no more honest.

## Tests

```bash
npm test                    # 102 checks, plain node --test, no framework
npm run test:browser        # 21 checks in real headless Chrome
npm run check               # svelte-check
```

`npm test` covers everything that is arithmetic: the two container writers, the
preset table and the files it generates, the export plan, the source limits and
the palette. It runs the TypeScript in `src/` directly — Node strips the types —
with a twelve-line resolver hook in `tests/ts-resolve.mjs` standing in for Vite's
extensionless imports.

Two things in there are worth knowing about if you extend it:

- `tests/containers.js` parses `.ico` and `.icns` from the format
  documentation, not from `src/`. Asserting that `packIco` produces what
  `packIco` produces would catch nothing; a round trip through an independent
  reader catches a wrong byte order or a wrong length field.
- `tests/pngbuild.js` builds real PNG files byte by byte, each size filled with
  a colour unique to it, so a container that packs the 32px frame where the 16px
  frame belongs fails an assertion instead of passing quietly.

`npm run test:browser` is the other half, and it is separate because it needs a
browser: `resize.ts` and `pipeline.ts` cannot run under Node at all. It builds
`tests/browser/harness.ts` with the project's own Vite, drives real Chrome over
the DevTools protocol, and asserts on a zip it actually unpacks. It exits 0 with
`SKIP` if no Chrome is installed, which is why it is not part of `npm test` —
there, a skip would read as a pass. `CHROME=<path>` overrides the search.

```bash
npm run test:browser:original
```

builds the same harness against `src/` as it was at the first commit. Nine of the
twenty-one checks fail there, which is the evidence for the defects listed in
`review.md`. A check named `regression:` that passes in this mode is testing
nothing, and the runner says so and fails.

On Windows there is one more, not wired into npm because it needs PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\platform\ico-check.ps1
```

13 checks. It writes a `.ico` with the project's own writer and opens it with the
Windows Imaging Component — the decoder Explorer uses — confirming the frame
count, each frame's size including the 256px one the format can only spell as
zero, and that each frame holds the image it should. Use WIC and not
`System.Drawing.Icon`: GDI+ predates PNG-in-ICO and misreads these files.

## Layout

```
src/
  presets.ts           the platform table: sizes, filenames, container groups
  lib/
    icoWriter.ts       .ico container
    icnsWriter.ts      .icns container
    zipPlan.ts         what the zip will contain, decided before anything runs
    sourceChecks.ts    size limits and the upscaling warning
    colorExtract.ts    median-cut palette
    resize.ts          canvas and pica: the only files that need a browser
    pipeline.ts        walks the plan, resizing once per size, and zips it
    *.svelte           DropZone, PresetPanel, OutputGrid, ColorSwatches, Icon
  App.svelte           two-pane layout; the sidebar becomes a drawer under 780px
```

`zipPlan.ts` and `sourceChecks.ts` hold the decisions, and `pipeline.ts` and
`resize.ts` hold the machinery that needs a DOM. That split is what lets almost
all of the behaviour be tested in Node in half a second.

## Dependencies

Three, all used: `pica` for resampling (visibly better than the browser's own
downscaling at 16px), `jszip` for the archive, `file-saver` for handing it to the
browser.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
