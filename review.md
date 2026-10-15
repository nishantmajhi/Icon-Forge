# Icon Forge — review and remediation record

First reviewed 2026-09-04. Remediated 2026-09-26 on `cleanup/2026-09-26`.

---

## Correction to the first review, at the top because it is the headline finding

**The first review's P2 was "add tests for `packIcns` and `packIco`, especially
byte order and length fields", and it was right that there were no tests and
wrong to imply there was a bug. Both writers were already byte-correct.**

The review named four things to assert and every one of them already held:

| What the review said to check | Result against the original code |
| --- | --- |
| header magic and total length match the real byte length | correct |
| each element's length field equals `8 + png.byteLength` | correct |
| lengths big-endian for `.icns`, little-endian for `.ico` | correct, both |
| a round trip returns the same PNGs | correct |

The evidence is 26 assertions in `tests/writers.test.js`, all of which pass
against the unmodified files, made through `tests/containers.js` — a pair of
parsers written from the format documentation rather than from the writers, so
the agreement is not a tautology. Plus, on the target platform,
`tests/platform/ico-check.ps1`: 13 checks that open a generated `.ico` with the
Windows Imaging Component, the decoder Explorer itself uses, and confirm four
frames at 16, 32, 48 and 256 pixels, each holding the image it should. The 256px
frame — the one the format can only spell as the byte 0, and the most plausible
place for an off-by-one — reads back as 256.

So the tests earned their place, and the code they were written to catch out did
not need catching. **Verify a claimed bug before fixing it**, and note that "this
is untested" and "this is broken" are different claims that a review can blur
together.

Two things the review did not look at, in the same two files, were wrong, and
both were silent:

- `packIco` masked the frame size to a byte, so a 512px frame was written as 0 —
  which a reader takes to mean 256. The file then claimed a 256px frame and held
  a 512px one. No preset does this today; the `windows-ico` preset stops at 256.
- `packIcns` copied the OSType a character at a time with `charCodeAt`, so a
  three-character string became `ic7\0`. `charCodeAt(3)` returns NaN and storing
  NaN in a `Uint8Array` gives 0. macOS skips an element with an unknown OSType
  without a word.

Both now throw. Neither was reachable from the preset table, so neither was a
live defect — they were landmines for whoever added the next preset.

**The second correction: the review's item 1 listed only `.icns`'s four
properties and said "`icoWriter.ts` does the equivalent for Windows".** The two
formats have *opposite* byte orders — `.ico` is little-endian throughout, `.icns`
is big-endian throughout — so "the equivalent" is the one description that would
be wrong. The writers know this and the review did not say so.

---

## What was actually wrong

Nine defects, in three places the review did not name. Each was reproduced
against the original code before it was fixed; `npm run test:browser:original`
rebuilds the browser harness against the first commit and fails exactly nine of
its twenty-one checks.

### 1. The iOS asset catalogue could not be used by Xcode (the worst of them)

`Contents.json` named each image by filename and pixel size and nothing else:

```json
{ "filename": "icon-20@2x.png", "size": "40x40" }
```

Xcode needs three things per entry beyond the filename — the `idiom` (device
family), the `size` **in points**, and the `scale`. Given only `40x40` it cannot
tell the 20pt@2x icon from a 40pt@1x one, treats every image as an unassigned
child of the set, and the app ships with no icon. There is no error, because the
catalogue is still well-formed JSON.

Worse, two entries were indistinguishable from each other: `icon-40@3x.png` and
`icon-60@2x.png` are both 120px, so both were described as `"size": "120x120"`.

The `ios` preset is one of fourteen and its only purpose is to drop into an Xcode
project, so this was the feature failing at the one thing it existed for.

Fixed by making the point size and scale the source of truth
(`iosSlots` in `src/presets.ts`) and **deriving** the pixel size from
`points × scale`, so the file and the entry describing it cannot drift apart. The
regression test asserts that arithmetic for every entry — `point size times scale
equals the pixel size of the file named` — and it is the assertion a future
addition would trip over.

### 2. The output grid promised files the zip did not contain

An output marked `icoGroup` was packed into the container **instead of** being
written as a loose PNG. `OutputGrid.svelte` lists outputs by name regardless, so
two presets advertised files that were not there:

- `favicon-pwa` showed `favicon-16x16.png`, `favicon-32x32.png` and
  `favicon-48x48.png`, and the zip contained none of the three. Those are the
  exact filenames every favicon guide's `<link rel="icon" sizes="32x32">` tags
  point at, so following one produced three 404s.
- `windows-ico` showed `frame-16.png` … `frame-256.png` and the zip held only
  `app.ico`.

Seven files across the two presets, and selecting everything showed 96 files and
delivered 89.

Fixed by always writing the loose PNG, which is what `icnsGroup` — declared two
lines away in the same interface — already documented for itself: *"loose png is
still written"*. **This is a judgement call and the author may prefer the other
one.** Making the zip match the grid was the additive fix and took nothing away;
the alternative is to hide ico-grouped outputs from the grid, which would change
what the page shows and so was not mine to make. The four `windows/frame-*.png`
files are the cost — arguably intermediates a user does not want.

### 3. The output grid under-counted, and dropped four filenames entirely

`generatePreviews` deduplicated by pixel size — correct for the resizing, which
should happen once per size, and wrong for the listing. The macOS iconset names
ten files across six distinct sizes, so the grid showed six of them, captioned
the group "6 files", and never mentioned `icon_32x32.png`, `icon_256x256.png`,
`icon_512x512.png` or `icon_16x16@2x.png` at all.

The zip always contained all ten — the dedupe was only in the preview path. I
had this the wrong way round at first and wrote a browser check asserting the
zip held ten files; it passed against the original, the runner reported that a
`regression:`-named check was testing nothing, and I corrected the claim. That
check is still there, unnamed as a regression, because a plan that started
dropping duplicate sizes from the archive would be far worse than the bug that
existed.

Fixed by separating the two: `previewOutputs` in `src/lib/zipPlan.ts` returns one
entry per file, and `generatePreviews` caches the resize by size.

### 4. The palette returned the same colour up to five times

Demonstrable in one line. A solid `#3366CC` image gave:

```
["#3366CC", "#3366CC", "#3366CC", "#3366CC", "#3366CC"]
```

Five identical swatches in the sidebar. Two causes compounding:

`medianCut` recursed to a fixed depth of `ceil(log2(count))`, so it always
produced a power of two boxes — eight for the five colours the app asks for —
regardless of how many colours the image actually had. Nothing merged boxes that
averaged to the same colour.

And the eight were then cut to five **by luminance**, after a sort whose comment
says it is for display order. So the three darkest boxes were discarded. On the
real quadrant fixture in the browser suite — red, green, blue and yellow — the
original's palette is `["#FFFF00","#FEFE01","#00FF00","#01FE00","#FE0101"]`:
**blue, one of the four colours actually present, is missing**, because it is the
darkest. A two-colour 50/50 red and blue image gave four reds and one blue.

Fixed by making it the textbook algorithm: split on demand, taking the box with
the greatest channel range, until there are `count` boxes or none can be split;
then merge equal colours, keeping pixel counts, and order by dominance. A
single-colour image now stops after zero splits and returns one colour.

This changes the order of the swatches from lightest-first to most-dominant-first.
I judged that part of the same defect rather than a UI change — "extract a palette
of dominant colours" is what the function's own docstring says, and the first
swatch is the one a user reaches for — but it is a visible change and is flagged
here for that reason.

### 5. The palette sampled a handful of vertical stripes

`step = floor(totalPixels / 10000)` walked the flat row-major index. That stride
is derived from `width × height`, so it shares a factor with the width whenever
the width is a round number. A 2000 × 2000 image gives a stride of 400, and 400
divides 2000 — so the samples landed in columns 0, 400, 800, 1200 and 1600, and
the other 1,995 columns were never read.

The test fixture paints red down exactly those five columns and blue everywhere
else. The original returns a palette of nothing but red for an image that is
99.75% blue.

**Latent, not live**: `App.svelte` only ever hands `extractPalette` the 128px
canvas, where the stride is 1. It is a defect in a function that reads like a
general one. Fixed by sampling on a two-dimensional grid.

### 6. A file that was not a PNG wedged the page

`DropZone.svelte` filters on `file.type !== 'image/png'` — the browser's reported
MIME type, which on Windows comes from the extension. So anything renamed to
`.png` passed the gate, and `handleFile` then did:

```ts
file = f;
previewUrl = URL.createObjectURL(f);
const img = await loadImage(f);   // rejects
```

`loadImage` rejects on `img.decode()`, the rejection was unhandled, and the page
was left having already accepted the file: a broken thumbnail, the filename shown,
no error, and no way back but a reload. The `FileTypeError` component that exists
for exactly this was never reached.

Fixed: the decode is in a `try`, a failure routes to the existing error
component, and nothing is committed to the UI until the image has decoded — which
also removes the flash of a preview for a file about to be rejected.

### 7. No ceiling on the source image, and the source canvas was rebuilt per size

The review named the first half (its P2: "a user can drop a 10,000 × 10,000 pixel
PNG"). The second half is what made it bite harder than the review thought.

`resizeToCanvas` allocated a canvas the full size of the source and re-drew the
source into it **on every call** — once per output size. At four bytes a pixel, a
10,000 × 10,000 PNG is 400 MB, and selecting every platform asks for about twenty
distinct sizes, so that is twenty allocations of 400 MB in turn, plus whatever
`pica` needs on top. The tab is killed, and a killed tab reports nothing at all.

Fixed both ways: `sourceToCanvas` draws once and the callers pass the canvas in,
and `checkSourceLimits` refuses anything over 8192px a side or 32 megapixels
before a single canvas is allocated. The megapixel cap exists because a per-side
cap lets 8000 × 8000 through, which is 61 megapixels.

The refusal reuses the existing warning element and the existing message style;
no new UI.

### 8. Every preview leaked its blob for the lifetime of the page

`generatePreviews` minted one object URL per image and nothing ever revoked them.
Previews are regenerated on every change of selection, so toggling platforms back
and forth retained a PNG per distinct size, every time, until the tab closed.
The source thumbnail's URL leaked the same way on every replacement.

Fixed with `revokePreviews`, called from `App.svelte` when a run is superseded and
when the image is cleared, plus revoking the previous thumbnail URL. The tracking
variable is deliberately not `$state`: the effect has to read it, and a tracked
read of something the effect also writes is a loop.

The browser suite asserts the half that can be asserted — that revoking really
does release, so the fix has something that works to call.

### 9. `npm run check` had never worked

Seven errors, one per component, all of them `"No Svelte configuration found in
vite config. Is @sveltejs/vite-plugin-svelte configured?"`. It looks like a broken
build configuration and it is a missing file: `svelte-check` needs
`svelte.config.js` to know how to preprocess a component, and falls back to
reading `vite.config.ts` when there is none. So the script type-checked nothing
and exited non-zero, from the first commit.

Added the file the Vite Svelte template ships. `npm run check` now reports 0
errors over 83 files, and I confirmed it actually checks by introducing a
deliberate type error and watching it fail.

---

## Tests

| | |
| --- | --- |
| `npm test` | 102 checks, `node --test`, no framework |
| `npm run test:browser` | 21 checks, real headless Chrome |
| `npm run test:browser:original` | the same 21 against the first commit: 9 fail |
| `tests/platform/ico-check.ps1` | 13 checks against the Windows Imaging Component |
| `npm run check` | 0 errors, 83 files |

Run three consecutive times each, green every time.

Four things in here are reusable and two of them cost time to find:

**`tests/containers.js` parses the two formats from their documentation**, not
from `src/`. This is the whole reason the writer tests mean anything.

**`tests/pngbuild.js` builds real PNGs byte by byte**, each size filled with a
colour unique to that size. The uniqueness matters: the first version derived the
colour linearly from the size and masked it to a byte, which gives 256, 512 and
1024 — three sizes this project uses — the identical colour, so a container that
swapped those frames would have round-tripped clean. It uses a mixing hash now,
and a test asserts all 21 fixtures are distinct. The fixtures were themselves
validated against an independent decoder (GDI+) before anything was asserted with
them.

**`tests/ts-resolve.mjs` lets `node --test` load the project's TypeScript
directly.** Node strips types unaided but requires the extension on a relative
import, and the source is written for Vite, which does not. Twelve lines of
`registerHooks` retrying with `.ts` appended, rather than a build step that would
mean asserting against a transformed copy of the file the reader sees.

**`tests/browser/run.js` drives Chrome over the DevTools protocol, not with
`--dump-dom`.** This is the one worth reading before writing another browser
harness in this archive, because the other five all use `--dump-dom` with
`--virtual-time-budget` and that **cannot work for this project**: `pica`
resamples in a Web Worker, and Chrome's virtual clock advances only the
renderer's own task queues. The `postMessage` goes out and the reply never comes
back, because the worker's thread is on a real clock the renderer has stopped
waiting for. The first `pica.resize` never settled, the dump happened anyway, and
the page said "running" with no error anywhere — which looks nothing like a
threading problem. Node has had a global `WebSocket` since v22, so CDP costs no
dependency and gives console output and uncaught exceptions as well.

Two diagnostics in that harness are there because their absence wasted time, and
both are worth copying: the page **publishes its results after every check**, so
a hang leaves behind everything before it and the name of the check it stopped
on; and the generated HTML carries **a classic inline error trap before the
module script**, because module scripts are deferred, so anything that throws
while the module graph is evaluating happens before the module's own handlers
exist.

The `--original` mode asserts a failure **count** as well as which checks fail, so
a harness change that quietly stops exercising a defect is caught. It is what
corrected my wrong claim in item 3 above.

---

## Deliberately not done

**No `LICENCE`** (the review's P3). Choosing a licence has legal consequence and
is the author's decision, not a remediation. The README says there is none.

**`file-saver` kept** (the review's P3, "may be unnecessary"). It is three lines
of behaviour that work, and its value is the browser quirks it papers over. More
to the point, a download cannot be verified in headless Chrome — downloads do not
complete — so replacing it would mean shipping an unverified change to the one
action the whole app exists to perform. `buildZipBlob` is now separate from
`exportZip`, so if the author wants to drop it, the swap is a three-line change
in one function with the archive already under test.

**Non-square and no-alpha sources still behave as they did** (the review's P3).
A non-square source is stretched to square. The review asks for "one line in the
UI at upload time", which is a UI change and out of scope; the README now states
both behaviours under "Things worth knowing", and the browser suite asserts the
stretching so that a change to it is noticed.

**The export summary's file count is still the PNG count.** "N files across M
platforms" now counts correctly per preset, but it excludes the `.ico`, `.icns`,
`Contents.json`, `site.webmanifest` and the two palette files. Fixing it properly
means either showing container tiles in the grid or changing the caption's
wording, and both are the author's call.

**The iOS preset is still iPhone-only.** No iPad sizes. That is a scope decision,
now documented rather than implicit, and the `Contents.json` generator would
extend to iPad by adding rows to `iosSlots`.

**`.icns` is verified only against the specification.** The `.ico` half is
confirmed by Windows itself. There is no Mac here, so nothing has opened a
generated `.icns` with macOS's loader — the 26 spec assertions and the round trip
through `tests/containers.js` are the whole of the evidence. If a Mac is ever
available: unzip the `macos.iconset` folder, set `AppIcon.icns` on a bundle, and
check all ten sizes appear in Finder at different zoom levels. That is the one
gap left in this project.

---

## Notes for whoever is next

The structure changed in one way worth knowing: **the decisions were pulled out
of the plumbing**, per this archive's convention. `zipPlan.ts` says what the
archive will contain and `sourceChecks.ts` says whether an image is usable, and
neither touches a canvas, JSZip or the DOM. `pipeline.ts` walks the plan and
`resize.ts` holds the canvas work; those two are the only files that need a
browser, and they are what the browser suite exists for. That split is why 102
of the 123 automated checks run in half a second under Node.

`src/presets.ts` remains the one file to edit to add a platform. The tests that
will catch a mistake there are in `tests/presets.test.js`: OSTypes are checked
against the pixel size Apple defines for each, `.ico` groups are checked to stay
within the 256px the format can describe, and filenames are checked for
uniqueness and for not escaping their folder.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs `npm test`, `npm run check` (svelte-check) and
`npm run build`, and the browser suite as a second job, on `ubuntu-latest`.
Nothing has been pushed, so it has not run on GitHub yet. Every job was run
before committing, from a fresh clone of this branch, the way a runner would
run it: Linux jobs in a throwaway Ubuntu 24.04 (the image `ubuntu-latest`
uses) with the same tool versions. 102, svelte-check clean, and the build
succeeding.

The browser job fails if the runner prints `SKIP`, which it does when it finds
no Chrome; otherwise a missing browser would read as a pass.
