/** The Uranian moons from a 1988 lithograph: the sheet, rasterising and ink measurement. */

import { execFile } from './io.ts';

// ---------------------------------------------------------------------------
// 2e. Lithographed photomosaics  (public domain)
//
// The five classical Uranian moons have never had a digital global mosaic
// published. USGS I-1920 (1988), "The Southern hemispheres of the Uranian
// satellites", is the only controlled photomosaic of them that exists, and it
// exists as three printed map sheets, scanned to PDF. Astropedia has only
// nomenclature and control networks for these bodies; neither S3 bucket has a
// raster; NAIF has no shape model. This is the whole of the published record.
//
// So the source here is a 1988 lithograph, and it has to be treated like one:
// rasterised, its projection recovered, its printed graticule taken back off,
// and its bare paper distinguished from its imagery.
// ---------------------------------------------------------------------------

export interface LithoMosaicSpec {
  out: string;
  /** Body key, for the log line only. */
  body: string;
  url: string;
  /**
   * Centre and latitude-0 radius of the controlled photomosaic on the page, in
   * pixels at LITHO_DPI. Fitted once, against the three printed latitude circles
   * at 0, -30 and -60 together: the outer circle alone cannot be told from the
   * mosaic's own dark edge beside it, and *summing* the three responses is no
   * better, because one strong ring then carries a solution where the other two
   * sit off the ink -- that put Titania's circle 5% oversize and printed a
   * displaced graticule across its terrain. Maximise the weakest of the three.
   * `pnpm validate` re-checks the result against the IAU Gazetteer rather than
   * trusting these numbers.
   */
  centreX: number;
  centreY: number;
  radius: number;
  credit: string;
  note: string;
}

/** The sheets are scanned at a resolution well above this; 300 dpi is plenty. */
const LITHO_DPI = 300;

/** Grey level at or above which paper is bare, once thin ink has been removed. */
export const LITHO_PAPER = 240;

export const LITHO_MOSAICS: LithoMosaicSpec[] = [
  {
    out: 'miranda.png',
    body: 'Miranda',
    url: 'https://pubs.usgs.gov/imap/1920/plate-1.pdf',
    centreX: 3168.5,
    centreY: 3681.3,
    radius: 2645.75,
    credit: 'USGS I-1920 sheet 1 (Voyager 2) — U.S. Geological Survey',
    note: 'Voyager 2 controlled photomosaic, 1:2,000,000',
  },
  {
    out: 'ariel.png',
    body: 'Ariel',
    url: 'https://pubs.usgs.gov/imap/1920/plate-2.pdf',
    centreX: 2945.5,
    centreY: 3302.0,
    radius: 2542.0,
    credit: 'USGS I-1920 sheet 2 (Voyager 2) — U.S. Geological Survey',
    note: 'Voyager 2 controlled photomosaic, 1:5,000,000',
  },
  {
    out: 'umbriel.png',
    body: 'Umbriel',
    url: 'https://pubs.usgs.gov/imap/1920/plate-3.pdf',
    centreX: 2199.8,
    centreY: 1908.0,
    radius: 1289.0,
    credit: 'USGS I-1920 sheet 3 (Voyager 2) — U.S. Geological Survey',
    note: 'Voyager 2 controlled photomosaic, 1:10,000,000',
  },
  {
    out: 'titania.png',
    body: 'Titania',
    url: 'https://pubs.usgs.gov/imap/1920/plate-3.pdf',
    centreX: 2185.3,
    centreY: 5705.8,
    radius: 1736.75,
    credit: 'USGS I-1920 sheet 3 (Voyager 2) — U.S. Geological Survey',
    note: 'Voyager 2 controlled photomosaic, 1:10,000,000',
  },
  {
    out: 'oberon.png',
    body: 'Oberon',
    url: 'https://pubs.usgs.gov/imap/1920/plate-3.pdf',
    centreX: 2176.3,
    centreY: 9891.8,
    radius: 1672.75,
    credit: 'USGS I-1920 sheet 3 (Voyager 2) — U.S. Geological Survey',
    note: 'Voyager 2 controlled photomosaic, 1:10,000,000',
  },
];

/**
 * Rasterise one page of a PDF into raw 8-bit grey.
 *
 * Crops are clamped to the page: ImageMagick answers a crop that runs off the
 * edge with a *smaller* image, and reading that back at the requested stride
 * shears the whole map into concentric arcs that look convincingly like terrain.
 */
export async function rasterise(
  src: string,
  crop: { x: number; y: number; w: number; h: number },
  extra: string[],
  dest: string,
): Promise<void> {
  await execFile('magick', [
    '-density',
    String(LITHO_DPI),
    `${src}[0]`,
    '-colorspace',
    'Gray',
    '-crop',
    `${crop.w}x${crop.h}+${crop.x}+${crop.y}`,
    '+repage',
    ...extra,
    '-depth',
    '8',
    `gray:${dest}`,
  ]);
}

export async function pageSize(src: string): Promise<[number, number]> {
  const { stdout } = await execFile('magick', [
    'identify',
    '-density',
    String(LITHO_DPI),
    '-format',
    '%w %h',
    `${src}[0]`,
  ]);
  const [w, h] = stdout.trim().split(/\s+/u).map(Number);
  return [w, h];
}

// Measure how far the ink actually reaches rather than assuming a width: the
// sheet letters its graticule ("-30", "-60") right against the lines, and a
// fixed-width repair leaves the digits printed across the terrain. The gap
// tolerance is what carries the repair over the whitespace around a glyph.
const measureInk = (sample: (d: number) => number, cap: number): [number, number] => {
  const far = (sample(cap) + sample(-cap)) / 2;
  const run = (dir: number): number => {
    let edge = 0;
    let gap = 0;
    for (let d = 1; d <= cap; d++) {
      const v = sample(dir * d);
      if (v >= 0 && v < far - 16) {
        edge = d;
        gap = 0;
      } else if (++gap > 5) {
        break;
      }
    }
    return edge;
  };
  return [-run(-1) - 1.5, run(1) + 1.5];
};

// Paint over one line crossing with a straight blend between the pixels just
// beyond either side of the ink.
export const bridge = (
  sample: (d: number) => number,
  write: (d: number, v: number) => void,
  cap: number,
  stepSize: number,
): void => {
  const [lo, hi] = measureInk(sample, cap);
  const a = sample(lo - 2);
  const b = sample(hi + 2);
  if (a < 0 || b < 0) {
    return;
  }
  for (let d = lo; d <= hi; d += stepSize) {
    const f = (d - lo) / Math.max(hi - lo, 0.5);
    write(d, Math.round(a * (1 - f) + b * f));
  }
};
