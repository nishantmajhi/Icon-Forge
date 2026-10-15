export interface OutputSpec {
  size: number;
  filename: string;
  /** if set, this output is packed into a multi-size .ico rather than saved as a loose png */
  icoGroup?: string;
  /** if set, this output is *also* packed into a multi-size .icns (loose png is still written) */
  icnsGroup?: string;
  /** required alongside icnsGroup — the 4-character Apple OSType for this icon size */
  icnsType?: string;
}

export interface Preset {
  id: string;
  label: string;
  category: 'dev' | 'mobile' | 'desktop' | 'web';
  folder: string;
  outputs: OutputSpec[];
  /** extra static files to include verbatim alongside the images (e.g. Contents.json, manifest) */
  extraFiles?: (colors: string[]) => { name: string; content: string }[];
}

export const CATEGORY_LABELS: Record<Preset['category'], string> = {
  dev: 'dev tools',
  mobile: 'mobile',
  desktop: 'desktop',
  web: 'web',
};

/*
 * The iPhone app-icon slots, as Xcode thinks of them: a device family, a size
 * in *points*, and a scale factor. The pixel size of the file is points times
 * scale, and it is derived below rather than written out, so the image and the
 * `Contents.json` entry describing it cannot drift apart.
 *
 * Xcode needs all three of these per entry. Given only a pixel size it has no
 * way to tell the 20pt@2x icon from a 40pt@1x one, treats every image as an
 * unassigned child of the set, and the app ships with no icon at all -- with no
 * error, because the catalogue itself is still well-formed.
 *
 * iPad (76pt, 83.5pt) and the 1x slots are deliberately absent: this is the
 * iPhone-only set, which is what an iPhone app needs and all the original
 * produced.
 */
const iosSlots = [
  { idiom: 'iphone', points: 20, scale: 2, filename: 'icon-20@2x.png' },
  { idiom: 'iphone', points: 20, scale: 3, filename: 'icon-20@3x.png' },
  { idiom: 'iphone', points: 29, scale: 2, filename: 'icon-29@2x.png' },
  { idiom: 'iphone', points: 29, scale: 3, filename: 'icon-29@3x.png' },
  { idiom: 'iphone', points: 40, scale: 2, filename: 'icon-40@2x.png' },
  { idiom: 'iphone', points: 40, scale: 3, filename: 'icon-40@3x.png' },
  { idiom: 'iphone', points: 60, scale: 2, filename: 'icon-60@2x.png' },
  { idiom: 'iphone', points: 60, scale: 3, filename: 'icon-60@3x.png' },
  // The App Store listing image. The only 1x slot, and not a device idiom.
  { idiom: 'ios-marketing', points: 1024, scale: 1, filename: 'icon-1024.png' },
];

const iosSizes: OutputSpec[] = iosSlots.map((slot) => ({
  size: slot.points * slot.scale,
  filename: slot.filename,
}));

const androidSizes = [
  { size: 48, filename: 'mipmap-mdpi/ic_launcher.png' },
  { size: 72, filename: 'mipmap-hdpi/ic_launcher.png' },
  { size: 96, filename: 'mipmap-xhdpi/ic_launcher.png' },
  { size: 144, filename: 'mipmap-xxhdpi/ic_launcher.png' },
  { size: 192, filename: 'mipmap-xxxhdpi/ic_launcher.png' },
  { size: 512, filename: 'play-store-icon.png' },
];

const macIconsetSizes = [
  { size: 16, filename: 'icon_16x16.png', icnsGroup: 'AppIcon.icns', icnsType: 'icp4' },
  { size: 32, filename: 'icon_16x16@2x.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic11' },
  { size: 32, filename: 'icon_32x32.png', icnsGroup: 'AppIcon.icns', icnsType: 'icp5' },
  { size: 64, filename: 'icon_32x32@2x.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic12' },
  { size: 128, filename: 'icon_128x128.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic07' },
  { size: 256, filename: 'icon_128x128@2x.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic13' },
  { size: 256, filename: 'icon_256x256.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic08' },
  { size: 512, filename: 'icon_256x256@2x.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic14' },
  { size: 512, filename: 'icon_512x512.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic09' },
  { size: 1024, filename: 'icon_512x512@2x.png', icnsGroup: 'AppIcon.icns', icnsType: 'ic10' },
];

export const PRESETS: Preset[] = [
  // ---------- dev tools ----------
  {
    id: 'browser-extension',
    label: 'Browser extension (Manifest V3)',
    category: 'dev',
    folder: 'browser-extension',
    outputs: [
      { size: 16, filename: 'icon16.png' },
      { size: 48, filename: 'icon48.png' },
      { size: 128, filename: 'icon128.png' },
    ],
  },
  {
    id: 'vscode-extension',
    label: 'VS Code extension',
    category: 'dev',
    folder: 'vscode-extension',
    outputs: [{ size: 128, filename: 'icon.png' }],
  },
  {
    id: 'jetbrains-plugin',
    label: 'JetBrains plugin',
    category: 'dev',
    folder: 'jetbrains-plugin',
    outputs: [{ size: 40, filename: 'pluginIcon.png' }],
  },
  {
    id: 'java-swing',
    label: 'Java Swing',
    category: 'dev',
    folder: 'java-swing',
    outputs: [16, 32, 48, 64].map((s) => ({ size: s, filename: `icon_${s}x${s}.png` })),
  },
  {
    id: 'javafx',
    label: 'JavaFX',
    category: 'dev',
    folder: 'javafx',
    outputs: [16, 32, 64, 128, 256].map((s) => ({ size: s, filename: `app-icon-${s}.png` })),
  },
  {
    id: 'tkinter',
    label: 'Tkinter',
    category: 'dev',
    folder: 'tkinter',
    outputs: [
      { size: 32, filename: 'icon.png' },
      { size: 64, filename: 'icon@2x.png' },
    ],
  },
  {
    id: 'qt',
    label: 'Qt application',
    category: 'dev',
    folder: 'qt',
    outputs: [16, 32, 64, 128, 256].map((s) => ({ size: s, filename: `app-${s}.png` })),
  },

  // ---------- mobile ----------
  {
    id: 'android',
    label: 'Android',
    category: 'mobile',
    folder: 'android',
    outputs: androidSizes,
  },
  {
    id: 'ios',
    label: 'iOS',
    category: 'mobile',
    folder: 'ios/AppIcon.appiconset',
    outputs: iosSizes,
    extraFiles: () => [
      {
        name: 'Contents.json',
        content: JSON.stringify(
          {
            images: iosSlots.map((slot) => ({
              filename: slot.filename,
              idiom: slot.idiom,
              size: `${slot.points}x${slot.points}`,
              scale: `${slot.scale}x`,
            })),
            info: { author: 'Icon Forge', version: 1 },
          },
          null,
          2
        ),
      },
    ],
  },
  {
    id: 'flutter',
    label: 'Flutter',
    category: 'mobile',
    folder: 'flutter',
    outputs: [
      ...androidSizes.map((o) => ({ ...o, filename: `android/${o.filename}` })),
      ...iosSizes.map((o) => ({ ...o, filename: `ios/${o.filename}` })),
      { size: 192, filename: 'web/icon-192.png' },
      { size: 512, filename: 'web/icon-512.png' },
    ],
  },

  // ---------- desktop ----------
  {
    id: 'electron',
    label: 'Electron',
    category: 'desktop',
    folder: 'electron',
    outputs: [16, 32, 64, 128, 256, 512, 1024].map((s) => ({ size: s, filename: `icon-${s}.png` })),
  },
  {
    id: 'macos-iconset',
    label: 'macOS .iconset',
    category: 'desktop',
    folder: 'macos.iconset',
    outputs: macIconsetSizes,
  },
  {
    id: 'windows-ico',
    label: 'Windows .ico',
    category: 'desktop',
    folder: 'windows',
    outputs: [16, 32, 48, 256].map((s) => ({ size: s, filename: `frame-${s}.png`, icoGroup: 'app.ico' })),
  },
  {
    id: 'linux-hicolor',
    label: 'Linux (hicolor theme)',
    category: 'desktop',
    folder: 'linux/hicolor',
    outputs: [16, 22, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, filename: `${s}x${s}/apps/icon.png` })),
  },

  // ---------- web ----------
  {
    id: 'favicon-pwa',
    label: 'Favicon / PWA set',
    category: 'web',
    folder: 'web',
    outputs: [
      { size: 16, filename: 'favicon-16x16.png', icoGroup: 'favicon.ico' },
      { size: 32, filename: 'favicon-32x32.png', icoGroup: 'favicon.ico' },
      { size: 48, filename: 'favicon-48x48.png', icoGroup: 'favicon.ico' },
      { size: 180, filename: 'apple-touch-icon.png' },
      { size: 192, filename: 'android-chrome-192x192.png' },
      { size: 512, filename: 'android-chrome-512x512.png' },
    ],
    extraFiles: () => [
      {
        name: 'site.webmanifest',
        content: JSON.stringify(
          {
            name: 'app',
            icons: [
              { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
              { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
            ],
            theme_color: '#ffffff',
            background_color: '#ffffff',
            display: 'standalone',
          },
          null,
          2
        ),
      },
    ],
  },
];

export const PRESETS_BY_CATEGORY = PRESETS.reduce<Record<string, Preset[]>>((acc, p) => {
  (acc[p.category] ||= []).push(p);
  return acc;
}, {});
