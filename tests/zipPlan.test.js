/*
 * What a selection puts in the zip.
 *
 * `planZip` is the layout decision with the canvas, the resampler and JSZip
 * taken out of it, which is the only reason these assertions can exist: before
 * the split, finding out what a preset produced meant running the whole
 * pipeline in a browser and unpacking the result.
 *
 * `tests/browser/run.js` then checks that a real zip built in a real browser
 * contains exactly the paths named here, so the plan cannot drift from what is
 * actually written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS } from '../src/presets.ts';
import { planZip, sizesRequired, previewOutputs } from '../src/lib/zipPlan.ts';

const byId = (id) => PRESETS.find((p) => p.id === id);
const pathsOf = (plan) => plan.map((e) => e.path);
const NO_COLOURS = [];
const COLOURS = ['#112233', '#445566'];

// ------------------------------------------------------------- the basics ---

test('an empty selection with no palette produces nothing', () => {
  assert.deepEqual(planZip([], NO_COLOURS), []);
});

test('every path is relative and inside the preset folder', () => {
  const plan = planZip(PRESETS, COLOURS);
  const folders = PRESETS.map((p) => p.folder);
  for (const entry of plan) {
    assert.ok(!entry.path.startsWith('/'), `${entry.path} is absolute`);
    assert.ok(!entry.path.split('/').includes('..'), `${entry.path} climbs out`);
    const atRoot = entry.path === 'colors.css' || entry.path === 'colors.json';
    assert.ok(atRoot || folders.some((f) => entry.path.startsWith(`${f}/`)),
      `${entry.path} is in no preset folder`);
  }
});

test('no two entries write the same path', () => {
  const paths = pathsOf(planZip(PRESETS, COLOURS));
  const seen = new Set();
  for (const p of paths) {
    assert.ok(!seen.has(p), `${p} is written twice`);
    seen.add(p);
  }
});

test('selecting every preset produces every preset folder', () => {
  const plan = planZip(PRESETS, NO_COLOURS);
  for (const preset of PRESETS) {
    assert.ok(plan.some((e) => e.path.startsWith(`${preset.folder}/`)),
      `${preset.id} contributed nothing`);
  }
});

test('selecting one preset produces only that preset folder', () => {
  const plan = planZip([byId('android')], NO_COLOURS);
  for (const entry of plan) {
    assert.ok(entry.path.startsWith('android/'), `${entry.path} is not in the android folder`);
  }
});

// ----------------------------------------- the grid and the zip must agree ---

/*
 * The assertion that names the defect this split was made to find.
 *
 * `windows-ico` and `favicon-pwa` both mark their PNG outputs with an
 * `icoGroup`. The original wrote only the packed container for those and
 * skipped the loose PNG -- while the output grid, which lists outputs by name,
 * went on showing all of them. So the grid promised `favicon-16x16.png`,
 * `favicon-32x32.png` and `favicon-48x48.png` and the zip held none of the
 * three, and those are the filenames a standard favicon `<link>` set points at.
 */
test('every image the output grid lists is in the zip', () => {
  const plan = planZip(PRESETS, NO_COLOURS);
  const inZip = new Set(pathsOf(plan));
  for (const preset of PRESETS) {
    for (const output of preset.outputs) {
      const path = `${preset.folder}/${output.filename}`;
      assert.ok(inZip.has(path), `the grid shows ${path} and the zip does not contain it`);
    }
  }
});

test('the favicon set contains the loose PNGs a favicon link tag references', () => {
  const plan = planZip([byId('favicon-pwa')], NO_COLOURS);
  const paths = pathsOf(plan);
  for (const name of ['favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png']) {
    assert.ok(paths.includes(`web/${name}`), `${name} is missing from ${JSON.stringify(paths)}`);
  }
});

test('previewOutputs lists one image per file, not one per distinct size', () => {
  const iconset = byId('macos-iconset');
  const previews = previewOutputs([iconset]);
  assert.equal(previews.length, iconset.outputs.length,
    'the macOS iconset names ten files across six sizes; all ten must be listed');
  assert.deepEqual(
    previews.map((p) => p.filename),
    iconset.outputs.map((o) => o.filename),
  );
});

test('previewOutputs tags every image with the preset it came from', () => {
  const previews = previewOutputs([byId('android'), byId('ios')]);
  const ids = new Set(previews.map((p) => p.presetId));
  assert.deepEqual([...ids].sort(), ['android', 'ios']);
});

// -------------------------------------------------------------- containers ---

test('the windows preset packs one ico holding its four frames', () => {
  const plan = planZip([byId('windows-ico')], NO_COLOURS);
  const icos = plan.filter((e) => e.kind === 'ico');
  assert.equal(icos.length, 1);
  assert.equal(icos[0].path, 'windows/app.ico');
  assert.deepEqual(icos[0].frames, [16, 32, 48, 256]);
});

test('the favicon preset packs one ico holding its three frames', () => {
  const plan = planZip([byId('favicon-pwa')], NO_COLOURS);
  const icos = plan.filter((e) => e.kind === 'ico');
  assert.equal(icos.length, 1);
  assert.equal(icos[0].path, 'web/favicon.ico');
  assert.deepEqual(icos[0].frames, [16, 32, 48]);
});

test('the favicon ico does not try to hold the 180px or larger outputs', () => {
  // apple-touch-icon and the two android-chrome PNGs are loose files, not ico
  // frames -- and 512 could not be an ico frame at all.
  const plan = planZip([byId('favicon-pwa')], NO_COLOURS);
  const ico = plan.find((e) => e.kind === 'ico');
  for (const size of ico.frames) {
    assert.ok(size <= 256, `${size}px cannot be an .ico frame`);
  }
});

test('the macOS preset packs one icns holding all ten OSTypes in order', () => {
  const plan = planZip([byId('macos-iconset')], NO_COLOURS);
  const icnses = plan.filter((e) => e.kind === 'icns');
  assert.equal(icnses.length, 1);
  assert.equal(icnses[0].path, 'macos.iconset/AppIcon.icns');
  assert.deepEqual(icnses[0].frames, [
    { osType: 'icp4', size: 16 },
    { osType: 'ic11', size: 32 },
    { osType: 'icp5', size: 32 },
    { osType: 'ic12', size: 64 },
    { osType: 'ic07', size: 128 },
    { osType: 'ic13', size: 256 },
    { osType: 'ic08', size: 256 },
    { osType: 'ic14', size: 512 },
    { osType: 'ic09', size: 512 },
    { osType: 'ic10', size: 1024 },
  ]);
});

test('a preset with no container groups produces no container entries', () => {
  const plan = planZip([byId('android'), byId('browser-extension')], NO_COLOURS);
  assert.equal(plan.filter((e) => e.kind === 'ico' || e.kind === 'icns').length, 0);
});

test('containers are written after the loose PNGs of their preset', () => {
  const plan = planZip([byId('windows-ico')], NO_COLOURS);
  const lastPng = plan.findLastIndex((e) => e.kind === 'png');
  const ico = plan.findIndex((e) => e.kind === 'ico');
  assert.ok(ico > lastPng, 'the container should come after the frames it packs');
});

// ------------------------------------------------------------ text entries ---

test('the iOS preset contributes its Contents.json inside the appiconset', () => {
  const plan = planZip([byId('ios')], NO_COLOURS);
  const text = plan.filter((e) => e.kind === 'text');
  assert.equal(text.length, 1);
  assert.equal(text[0].path, 'ios/AppIcon.appiconset/Contents.json');
  assert.doesNotThrow(() => JSON.parse(text[0].content));
});

test('the palette files appear at the root, and only when there is a palette', () => {
  const withColours = pathsOf(planZip([byId('android')], COLOURS));
  assert.ok(withColours.includes('colors.css'));
  assert.ok(withColours.includes('colors.json'));

  const without = pathsOf(planZip([byId('android')], NO_COLOURS));
  assert.ok(!without.includes('colors.css'));
  assert.ok(!without.includes('colors.json'));
});

test('colors.css declares one custom property per colour, numbered from one', () => {
  const plan = planZip([], ['#AABBCC', '#DDEEFF', '#123456']);
  const css = plan.find((e) => e.path === 'colors.css').content;
  assert.match(css, /--icon-color-1:\s*#AABBCC;/);
  assert.match(css, /--icon-color-2:\s*#DDEEFF;/);
  assert.match(css, /--icon-color-3:\s*#123456;/);
  assert.equal((css.match(/--icon-color-/g) ?? []).length, 3);
});

test('colors.json round-trips the palette exactly', () => {
  const colours = ['#AABBCC', '#DDEEFF'];
  const plan = planZip([], colours);
  assert.deepEqual(JSON.parse(plan.find((e) => e.path === 'colors.json').content), colours);
});

// ------------------------------------------------------------ sizesRequired --

test('sizesRequired returns each size once, ascending', () => {
  const sizes = sizesRequired(planZip([byId('macos-iconset')], NO_COLOURS));
  assert.deepEqual(sizes, [16, 32, 64, 128, 256, 512, 1024]);
});

test('sizesRequired covers every size any entry in the plan needs', () => {
  const plan = planZip(PRESETS, COLOURS);
  const available = new Set(sizesRequired(plan));
  for (const entry of plan) {
    if (entry.kind === 'png') {
      assert.ok(available.has(entry.size), `${entry.path} needs ${entry.size}px`);
    } else if (entry.kind === 'ico') {
      for (const size of entry.frames) assert.ok(available.has(size), `${entry.path} needs ${size}px`);
    } else if (entry.kind === 'icns') {
      for (const f of entry.frames) assert.ok(available.has(f.size), `${entry.path} needs ${f.size}px`);
    }
  }
});

test('sizesRequired is far smaller than the file count, which is the point of it', () => {
  const plan = planZip(PRESETS, COLOURS);
  const files = plan.filter((e) => e.kind === 'png').length;
  const sizes = sizesRequired(plan).length;
  assert.ok(sizes < files, `${sizes} resizes for ${files} files`);
});

test('a container frame never needs a size no loose PNG already needed', () => {
  // If this ever fails, a container is asking for a resize that would otherwise
  // not happen -- which is fine, but means the ico/icns branches of
  // sizesRequired are load-bearing rather than belt and braces.
  const plan = planZip(PRESETS, NO_COLOURS);
  const fromPngs = new Set(plan.filter((e) => e.kind === 'png').map((e) => e.size));
  for (const entry of plan) {
    if (entry.kind === 'ico') {
      for (const size of entry.frames) assert.ok(fromPngs.has(size), `${entry.path} frame ${size}px`);
    }
    if (entry.kind === 'icns') {
      for (const f of entry.frames) assert.ok(fromPngs.has(f.size), `${entry.path} frame ${f.size}px`);
    }
  }
});
