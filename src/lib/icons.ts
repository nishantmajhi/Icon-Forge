export type IconName =
  | 'brand'
  | 'upload'
  | 'download'
  | 'loader'
  | 'x'
  | 'search'
  | 'warning'
  | 'empty'
  | 'tools'
  | 'mobile'
  | 'desktop'
  | 'web';

interface Circle {
  cx: number;
  cy: number;
  r: number;
  filled?: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

interface IconDef {
  viewBox: string;
  paths?: string[];
  circles?: Circle[];
  rects?: Rect[];
}

export const ICONS: Record<IconName, IconDef> = {
  brand: {
    viewBox: '0 0 24 24',
    paths: [
      'M12 2c2 4-2 5-1 9 3-1 4-4 3-6 3 2 4 6 1 10-4 5-11 3-11-2 0-3 2-4 3-7 1 2 0 3 1 4 1-2 2-4 4-8z',
    ],
  },
  upload: {
    viewBox: '0 0 24 24',
    paths: ['M12 4v11', 'M7.5 8.5 12 4l4.5 4.5', 'M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5'],
  },
  download: {
    viewBox: '0 0 24 24',
    paths: ['M12 3v11', 'M7.5 10.5 12 15l4.5-4.5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  },
  loader: {
    viewBox: '0 0 24 24',
    paths: ['M12 3a9 9 0 1 0 9 9'],
  },
  x: {
    viewBox: '0 0 24 24',
    paths: ['M6 6l12 12M18 6L6 18'],
  },
  search: {
    viewBox: '0 0 24 24',
    paths: ['m20 20-3.8-3.8'],
    circles: [{ cx: 11, cy: 11, r: 6.5 }],
  },
  warning: {
    viewBox: '0 0 24 24',
    paths: ['M12 3 2 20h20L12 3z', 'M12 10v4'],
    circles: [{ cx: 12, cy: 17, r: 0.6, filled: true }],
  },
  empty: {
    viewBox: '0 0 24 24',
    paths: ['M4 8l3.5-4.5h9L20 8', 'M9 13.5a3 3 0 0 0 6 0'],
    rects: [{ x: 4, y: 8, width: 16, height: 12, rx: 1.5 }],
  },
  tools: {
    viewBox: '0 0 24 24',
    paths: ['M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z'],
  },
  mobile: {
    viewBox: '0 0 24 24',
    paths: ['M11 18h2'],
    rects: [{ x: 7, y: 2.5, width: 10, height: 19, rx: 2 }],
  },
  desktop: {
    viewBox: '0 0 24 24',
    paths: ['M8 20h8M12 16v4'],
    rects: [{ x: 3, y: 4, width: 18, height: 12, rx: 1.5 }],
  },
  web: {
    viewBox: '0 0 24 24',
    paths: ['M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z'],
    circles: [{ cx: 12, cy: 12, r: 9 }],
  },
};

export const CATEGORY_ICON: Record<string, IconName> = {
  dev: 'tools',
  mobile: 'mobile',
  desktop: 'desktop',
  web: 'web',
};
