/*
 * The preset table, and the two static files it generates.
 *
 * The presets are data, so most of what can be wrong with them is a wrong
 * number or a wrong name -- and those are exactly the mistakes that produce a
 * zip a user unpacks, drops into a project, and only discovers is wrong when
 * the build tool refuses it. Checking them against the platform requirements
 * costs nothing to run.
 *
 * `Contents.json` and `site.webmanifest` are the two files here that another
 * program has to parse, so they get the closest attention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, PRESETS_BY_CATEGORY, CATEGORY_LABELS } from '../src/presets.ts';

const byId = (id) => {
  const preset = PRESETS.find((p) => p.id === id);
  assert.ok(preset, `no preset with id ${id}`);
  return preset;
};

// ------------------------------------------------------- table invariants ---

test('preset ids are unique', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(', ')}`);
});

test('preset output folders are unique, so no two presets overwrite each other', () => {
  const folders = PRESETS.map((p) => p.folder);
  assert.equal(new Set(folders).size, folders.length, `duplicate folder in ${folders.join(', ')}`);
});

test('every preset has at least one output', () => {
  for (const p of PRESETS) {
    assert.ok(p.outputs.length > 0, `${p.id} produces nothing`);
  }
});

test('every category used has a label, and every label is used', () => {
  const used = new Set(PRESETS.map((p) => p.category));
  for (const c of used) assert.ok(CATEGORY_LABELS[c], `category ${c} has no label`);
  for (const c of Object.keys(CATEGORY_LABELS)) assert.ok(used.has(c), `label ${c} matches no preset`);
});

test('PRESETS_BY_CATEGORY holds every preset exactly once', () => {
  const flat = Object.values(PRESETS_BY_CATEGORY).flat();
  assert.equal(flat.length, PRESETS.length);
  assert.deepEqual(new Set(flat.map((p) => p.id)), new Set(PRESETS.map((p) => p.id)));
});

test('no output size is zero, negative or fractional', () => {
  for (const p of PRESETS) {
    for (const o of p.outputs) {
      assert.ok(Number.isInteger(o.size) && o.size > 0, `${p.id}/${o.filename} is ${o.size}px`);
    }
  }
});

test('within one preset no two outputs share a filename', () => {
  for (const p of PRESETS) {
    const names = p.outputs.map((o) => o.filename);
    assert.equal(new Set(names).size, names.length,
      `${p.id} writes the same name twice: ${names.join(', ')}`);
  }
});

test('no output filename is absolute or climbs out of its folder', () => {
  for (const p of PRESETS) {
    for (const o of p.outputs) {
      assert.ok(!o.filename.startsWith('/'), `${p.id}/${o.filename} is absolute`);
      assert.ok(!o.filename.split('/').includes('..'), `${p.id}/${o.filename} climbs out`);
    }
  }
});

test('an icns output always carries the OSType that packing it needs', () => {
  for (const p of PRESETS) {
    for (const o of p.outputs) {
      if (o.icnsGroup) {
        assert.ok(o.icnsType, `${p.id}/${o.filename} is in an icns group with no icnsType`);
        assert.equal(o.icnsType.length, 4, `${o.icnsType} is not a 4-character OSType`);
      }
    }
  }
});

// ------------------------------------------------------------- .ico limits --

/*
 * The .ico directory stores width and height in one byte each, so 256 is the
 * largest size the format can name -- it is spelled as 0 by convention, and
 * there is no convention for anything larger. A preset that asked for a 512px
 * frame would produce a container claiming a size it does not hold.
 */
test('no ico group asks for a frame larger than the format can describe', () => {
  for (const p of PRESETS) {
    for (const o of p.outputs) {
      if (o.icoGroup) {
        assert.ok(o.size <= 256, `${p.id}/${o.filename} wants a ${o.size}px frame in an .ico`);
      }
    }
  }
});

// --------------------------------------------------- macOS OSType mapping ---

/*
 * Apple's OSTypes each mean one exact pixel size. A mapping that is off by one
 * row produces an .icns that macOS loads and then draws at the wrong size, or
 * ignores -- and there is no error either way.
 */
const OSTYPE_PIXELS = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};

test('every icns OSType is paired with the pixel size Apple defines for it', () => {
  for (const p of PRESETS) {
    for (const o of p.outputs) {
      if (!o.icnsType) continue;
      const expected = OSTYPE_PIXELS[o.icnsType];
      assert.ok(expected, `${o.icnsType} is not an OSType this project should be emitting`);
      assert.equal(o.size, expected,
        `${p.id}/${o.filename} pairs ${o.icnsType} with ${o.size}px, but ${o.icnsType} means ${expected}px`);
    }
  }
});

test('no OSType appears twice in one icns group', () => {
  for (const p of PRESETS) {
    const seen = new Map();
    for (const o of p.outputs) {
      if (!o.icnsGroup) continue;
      const key = `${o.icnsGroup}/${o.icnsType}`;
      assert.ok(!seen.has(key), `${p.id} puts ${o.icnsType} in ${o.icnsGroup} twice`);
      seen.set(key, o.filename);
    }
  }
});

test('the macOS iconset covers all ten sizes a .icns is expected to carry', () => {
  const iconset = byId('macos-iconset');
  const types = iconset.outputs.filter((o) => o.icnsType).map((o) => o.icnsType);
  assert.deepEqual([...types].sort(), Object.keys(OSTYPE_PIXELS).filter((t) => t !== 'icp6').sort());
});

// ------------------------------------------------------- iOS Contents.json --

/*
 * The one generated file with a schema somebody else enforces.
 *
 * Xcode reads `Contents.json` to decide which image is which. Each entry needs
 * three things beyond the filename: the `idiom` (which device family), the
 * `size` in *points*, and the `scale`. A 40px image for the 20pt slot is
 * `"size": "20x20", "scale": "2x"` -- 20 points at 2x. Writing `"size":
 * "40x40"` with no scale, as the original did, gives Xcode no way to tell the
 * 20pt@2x image from the 40pt@1x one, and it treats every entry as an
 * unassigned child: the catalogue compiles, and the app ships with no icon.
 */
function contentsJsonOf(presetId) {
  const preset = byId(presetId);
  assert.ok(preset.extraFiles, `${presetId} generates no extra files`);
  const file = preset.extraFiles([]).find((f) => f.name === 'Contents.json');
  assert.ok(file, `${presetId} generates no Contents.json`);
  return JSON.parse(file.content);
}

test('Contents.json parses and has the two keys Xcode looks for', () => {
  const contents = contentsJsonOf('ios');
  assert.ok(Array.isArray(contents.images), 'images must be an array');
  assert.equal(contents.info.version, 1, 'info.version must be 1');
  assert.ok(typeof contents.info.author === 'string' && contents.info.author.length > 0);
});

test('every Contents.json entry names an idiom, a point size and a scale', () => {
  for (const image of contentsJsonOf('ios').images) {
    assert.ok(image.filename, `an entry has no filename: ${JSON.stringify(image)}`);
    assert.ok(image.idiom, `${image.filename} has no idiom`);
    assert.ok(image.size, `${image.filename} has no size`);
    assert.ok(image.scale, `${image.filename} has no scale`);
    assert.match(image.size, /^\d+(\.\d+)?x\d+(\.\d+)?$/, `${image.filename} size ${image.size} is malformed`);
    assert.match(image.scale, /^[123]x$/, `${image.filename} scale ${image.scale} is malformed`);
  }
});

/*
 * The arithmetic that makes the catalogue mean what the files are: the point
 * size multiplied by the scale has to be the image's real pixel size. This is
 * the assertion that catches the original's use of pixels where points belong,
 * and it would catch a future preset that added a size and forgot to convert.
 */
test('point size times scale equals the pixel size of the file named', () => {
  const ios = byId('ios');
  const pixelsByName = new Map(ios.outputs.map((o) => [o.filename, o.size]));

  for (const image of contentsJsonOf('ios').images) {
    const points = Number(image.size.split('x')[0]);
    const scale = Number(image.scale.replace('x', ''));
    const pixels = pixelsByName.get(image.filename);
    assert.ok(pixels, `Contents.json names ${image.filename}, which the preset does not produce`);
    assert.equal(points * scale, pixels,
      `${image.filename} is ${pixels}px but the catalogue calls it ${image.size} at ${image.scale}`);
  }
});

test('Contents.json names every file the iOS preset produces, and only those', () => {
  const ios = byId('ios');
  const produced = ios.outputs.map((o) => o.filename).sort();
  const named = contentsJsonOf('ios').images.map((i) => i.filename).sort();
  assert.deepEqual(named, produced);
});

test('the 1024px entry is the marketing icon, which is the only 1x slot', () => {
  const images = contentsJsonOf('ios').images;
  const marketing = images.filter((i) => i.idiom === 'ios-marketing');
  assert.equal(marketing.length, 1, 'exactly one marketing icon');
  assert.equal(marketing[0].size, '1024x1024');
  assert.equal(marketing[0].scale, '1x');
});

test('every non-marketing entry is an iPhone slot at 2x or 3x', () => {
  for (const image of contentsJsonOf('ios').images) {
    if (image.idiom === 'ios-marketing') continue;
    assert.equal(image.idiom, 'iphone', `${image.filename} claims idiom ${image.idiom}`);
    assert.notEqual(image.scale, '1x', `${image.filename} is a 1x iPhone slot, which no longer exists`);
  }
});

test('no two Contents.json entries claim the same idiom, size and scale', () => {
  const seen = new Set();
  for (const image of contentsJsonOf('ios').images) {
    const key = `${image.idiom}/${image.size}/${image.scale}`;
    assert.ok(!seen.has(key), `two entries claim ${key}`);
    seen.add(key);
  }
});

// ------------------------------------------------------- site.webmanifest ---

test('site.webmanifest parses and its icons exist in the preset', () => {
  const web = byId('favicon-pwa');
  const file = web.extraFiles([]).find((f) => f.name === 'site.webmanifest');
  assert.ok(file, 'favicon-pwa generates no site.webmanifest');

  const manifest = JSON.parse(file.content);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

  const produced = new Set(web.outputs.map((o) => o.filename));
  for (const icon of manifest.icons) {
    assert.ok(produced.has(icon.src), `the manifest points at ${icon.src}, which is not produced`);
    assert.equal(icon.type, 'image/png');
    // The declared size has to be the size of the file, or a browser picks wrong.
    const declared = Number(icon.sizes.split('x')[0]);
    const actual = web.outputs.find((o) => o.filename === icon.src).size;
    assert.equal(declared, actual, `${icon.src} is ${actual}px, declared as ${icon.sizes}`);
  }
});

test('the PWA manifest asks for the two sizes the install prompt needs', () => {
  const web = byId('favicon-pwa');
  const manifest = JSON.parse(web.extraFiles([]).find((f) => f.name === 'site.webmanifest').content);
  const sizes = manifest.icons.map((i) => Number(i.sizes.split('x')[0])).sort((a, b) => a - b);
  assert.ok(sizes.includes(192), 'a PWA manifest needs a 192px icon');
  assert.ok(sizes.includes(512), 'a PWA manifest needs a 512px icon');
});

// ---------------------------------------------------------- Android sizes ---

/*
 * The density buckets are fixed multiples of 48dp: mdpi is 1x, hdpi 1.5x,
 * xhdpi 2x, xxhdpi 3x, xxxhdpi 4x. Getting one wrong gives a launcher icon
 * that Android scales, which is visible and has no error message.
 */
test('Android density folders hold the pixel size their bucket means', () => {
  const expected = {
    'mipmap-mdpi/ic_launcher.png': 48,
    'mipmap-hdpi/ic_launcher.png': 72,
    'mipmap-xhdpi/ic_launcher.png': 96,
    'mipmap-xxhdpi/ic_launcher.png': 144,
    'mipmap-xxxhdpi/ic_launcher.png': 192,
    'play-store-icon.png': 512,
  };
  const android = byId('android');
  assert.deepEqual(
    Object.fromEntries(android.outputs.map((o) => [o.filename, o.size])),
    expected,
  );
});

test('the Flutter preset carries the Android and iOS sets through unchanged', () => {
  const flutter = byId('flutter');
  const android = byId('android');
  const ios = byId('ios');

  for (const o of android.outputs) {
    const carried = flutter.outputs.find((f) => f.filename === `android/${o.filename}`);
    assert.ok(carried, `flutter is missing android/${o.filename}`);
    assert.equal(carried.size, o.size);
  }
  for (const o of ios.outputs) {
    const carried = flutter.outputs.find((f) => f.filename === `ios/${o.filename}`);
    assert.ok(carried, `flutter is missing ios/${o.filename}`);
    assert.equal(carried.size, o.size);
  }
});
