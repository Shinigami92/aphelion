/** Imagery that exists only as a FITS array in a PDS archive. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download, mb, TEXTURES } from './io.ts';
import { encodePng } from './png.ts';

// ---------------------------------------------------------------------------
// 2d. FITS mosaics  (public domain)
//
// A couple of bodies have real imagery that exists only as a FITS array in a
// PDS archive rather than as a browse image. FITS is a short read — 2880-byte
// blocks of 80-character ASCII cards, then the raw array — so this pulls them
// straight into a texture rather than leaving the body to the procedural
// generator, which serves small irregular moons particularly badly.
// ---------------------------------------------------------------------------

interface FitsMosaicSpec {
  out: string;
  url: string;
  /** East longitude of the array's left-hand column, degrees. */
  originLonEast: number;
  /** True when row 0 is the southernmost, as FITS and IDL conventionally store. */
  bottomUp: boolean;
  /** Pixels equal to this are unimaged and get flattened to the image mean. */
  blankValue?: number;
  credit: string;
  note: string;
}

export const FITS_MOSAICS: FitsMosaicSpec[] = [
  {
    out: 'deimos.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimosm.fit',
    originLonEast: 0,
    // Not stated in the header, but the shape table in the same bundle by the
    // same author is explicitly south-first, and this array's unimaged gap then
    // lands on the same longitudes *and* latitudes as that model's oddly smooth
    // southern depression — which is what an uncovered region would produce.
    // Two independent products agreeing is the best evidence available here.
    bottomUp: true,
    blankValue: 0,
    credit: 'Thomas Deimos mosaic (Viking) — PDS Small Bodies Node',
    note: 'Viking mosaic, high-pass filtered',
  },
];

export async function buildFitsMosaic(spec: FitsMosaicSpec): Promise<boolean> {
  const cachePath = path.join(CACHE, path.basename(spec.url));
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
    return false;
  }

  const buf = await fs.readFile(cachePath);
  // Header is whole 2880-byte blocks of 80-character cards, ending at END.
  const card = (name: string): string | null => {
    for (let off = 0; off + 80 <= buf.length; off += 80) {
      const text = buf.toString('ascii', off, off + 80);
      if (text.startsWith('END ') || text.trimEnd() === 'END') {
        return null;
      }
      if (text.startsWith(name.padEnd(8))) {
        return text.slice(10).split('/')[0].trim();
      }
    }
    return null;
  };
  const bitpix = Number(card('BITPIX'));
  const w = Number(card('NAXIS1'));
  const h = Number(card('NAXIS2'));
  if (bitpix !== 8 || !w || !h) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: expected 8-bit 2D FITS, got BITPIX ${bitpix} ${w}x${h}`,
    );
    return false;
  }

  let headerEnd = 0;
  for (let off = 0; off + 80 <= buf.length; off += 80) {
    const text = buf.toString('ascii', off, off + 80);
    if (text.startsWith('END ') || text.trimEnd() === 'END') {
      headerEnd = Math.ceil((off + 80) / 2880) * 2880;
      break;
    }
  }
  const data = buf.subarray(headerEnd, headerEnd + w * h);
  if (data.length !== w * h) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: expected ${w * h} pixels, got ${data.length}`);
    return false;
  }

  // Mean of the imaged pixels, used to flatten the gaps.
  let sum = 0;
  let count = 0;
  for (const value of data) {
    if (spec.blankValue !== undefined && value === spec.blankValue) {
      continue;
    }
    sum += value;
    count++;
  }
  const fill = count ? Math.round(sum / count) : 128;
  const blanks = data.length - count;

  const shift = Math.round((w * (180 - spec.originLonEast)) / 360);
  const out = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const src = spec.bottomUp ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const v = data[src * w + ((x + shift) % w)];
      // Unimaged terrain is flattened rather than smeared: a flat patch reads as
      // "nothing was seen here", where dilating the neighbours would invent
      // surface that no spacecraft ever resolved.
      out[y * w + x] = spec.blankValue !== undefined && v === spec.blankValue ? fill : v;
    }
  }

  await fs.mkdir(TEXTURES, { recursive: true });
  const png = encodePng(w, h, out, 1);
  await fs.writeFile(path.join(TEXTURES, spec.out), png);
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h} grey, ${((blanks / data.length) * 100).toFixed(1)}% unimaged filled, ${mb(png.length)}`,
    )}`,
  );
  return true;
}
