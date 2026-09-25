/** Global elevation grids turned into relief maps, and the relief module they feed. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download, mb, SHAPES } from './io.ts';
import { encodePng } from './png.ts';
import { unzipEntry } from './zip.ts';

// ---------------------------------------------------------------------------
// 2c. Topography  (public domain)
//
// Relief comes from published global elevation grids, not from mesh files. One
// equirectangular height map serves both the near-spheres, whose relief is only
// visible once explore mode exaggerates it, and (later) the small bodies, whose
// shape models resample onto the same grid. A mesh cannot do the first job:
// exaggeration would mean re-baking geometry per level, where a height map needs
// a single uniform — and a mesh would also carry one fixed tessellation, where
// the map displaces all four of our LOD spheres.
// ---------------------------------------------------------------------------

interface ReliefSpec {
  /** Body key, matching src/data/bodies.ts. */
  body: string;
  out: string;
  url: string;
  width: number;
  height: number;
  /** Metres of elevation per stored raster unit. */
  metresPerDn: number;
  /**
   * Byte order of the 16-bit samples. Not a detail worth guessing: MOLA ships
   * MSB and LOLA ships LSB, and reading one as the other yields a full-range
   * grid of plausible-looking noise rather than an obvious failure.
   */
  endian: 'msb' | 'lsb';
  /** East longitude of the source raster's left-hand column, degrees. */
  originLonEast: number;
  /**
   * Name fragment of the entry to pull out, when the download is a zip. Only
   * stored/deflated entries without data descriptors, which is what these
   * archives use.
   */
  zipEntry?: string;
  /**
   * True when samples sit on cell *corners* rather than centres, so the grid
   * includes both poles and repeats the 180 degree meridian. ETOPO does this;
   * the PDS products do not.
   */
  gridRegistered?: boolean;
  /** Output grid, when it should differ from the source. Block-averaged. */
  outWidth?: number;
  outHeight?: number;
  /**
   * Clamp elevations below this, in metres. Earth needs it at 0: the visible
   * surface over an ocean is the water, not the sea bed, and displacing
   * bathymetry would carve a trench through the blue.
   */
  floorMetres?: number;
  credit: string;
  note: string;
}

export const RELIEF: ReliefSpec[] = [
  {
    body: 'mars',
    out: 'mars_relief.png',
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img',
    width: 1440,
    height: 720,
    metresPerDn: 1,
    endian: 'msb',
    originLonEast: 0,
    credit: 'MGS MOLA MEGDR — NASA/JPL/GSFC, PDS Geosciences Node',
    note: 'MOLA MEGDR, 4 px/deg',
  },
  {
    body: 'moon:Moon',
    out: 'moon_relief.png',
    url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img',
    width: 1440,
    height: 720,
    // LOLA's LDEM is a shape map: radius minus a 1737.4 km reference sphere,
    // stored at half-metre resolution. Our own lunar radius differs from that
    // reference by a few hundred metres, which is a uniform sphere-size offset
    // of 0.02% and invisible.
    metresPerDn: 0.5,
    endian: 'lsb',
    originLonEast: 0,
    credit: 'LRO LOLA LDEM — NASA/GSFC, PDS Geosciences Node',
    note: 'LOLA LDEM, 4 px/deg',
  },
  {
    body: 'earth',
    out: 'earth_relief.png',
    url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2/ETOPO2v2-2006/ETOPO2v2g/raw_binary/ETOPO2v2g_i2_LSB.zip',
    zipEntry: '.bin',
    // Straight from the archive's own .hdr rather than assumed: 10801 x 5401,
    // corner-registered from 180W/90N, little-endian metres.
    width: 10801,
    height: 5401,
    metresPerDn: 1,
    endian: 'lsb',
    originLonEast: 180,
    gridRegistered: true,
    outWidth: 2048,
    outHeight: 1024,
    // Sea level. Earth is the only body here whose visible surface is not its
    // solid surface over most of its area.
    floorMetres: 0,
    credit: 'ETOPO2v2 — NOAA National Centers for Environmental Information',
    note: 'ETOPO2v2, 2 arc-min, land only',
  },
];

export interface ReliefResult {
  body: string;
  out: string;
  width: number;
  height: number;
  minKm: number;
  maxKm: number;
  credit: string;
}

/**
 * Turn a raw 16-bit signed big-endian elevation raster into a relief PNG.
 *
 * Two deliberate transforms. The grid is rolled half a turn so its left edge is
 * 180 degrees west, matching the colour mosaics and letting relief and albedo
 * share one set of UVs — offsetting in the shader instead would need a fract()
 * that breaks derivative-based normals at the seam. And elevation is split
 * across the red (high byte) and green (low byte) channels, because browsers
 * decode 16-bit PNGs down to 8 bits, and 8 bits across Mars's 29 km range is a
 * 115 m quantum: that shows up as terraced normals long before it shows up as
 * a wrong altitude.
 */
export async function buildRelief(spec: ReliefSpec): Promise<ReliefResult | null> {
  const outPath = path.join(SHAPES, spec.out);
  const cachePath = path.join(CACHE, path.basename(spec.url));
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
    return null;
  }

  // Widened because inflateRawSync's buffer is not the same flavour readFile's
  // is, and the two have to share this variable.
  let raw: Buffer = await fs.readFile(cachePath);
  if (spec.zipEntry !== undefined && spec.zipEntry !== '') {
    const entry = unzipEntry(raw, spec.zipEntry);
    if (!entry) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: no usable zip entry matching ${spec.zipEntry}`,
      );
      return null;
    }
    raw = entry;
  }

  const srcCount = spec.width * spec.height;
  if (raw.length !== srcCount * 2) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: expected ${srcCount * 2} bytes, got ${raw.length}`,
    );
    return null;
  }

  const w = spec.outWidth ?? spec.width;
  const h = spec.outHeight ?? spec.height;

  // Where each source sample actually sits. Corner-registered grids repeat the
  // 180 degree meridian and include both poles, so their spacing is one cell
  // wider than a centre-registered grid of the same column count.
  const lonOfCol =
    spec.gridRegistered === true
      ? (c: number) => spec.originLonEast + (c * 360) / (spec.width - 1)
      : (c: number) => spec.originLonEast + ((c + 0.5) * 360) / spec.width;
  const latOfRow =
    spec.gridRegistered === true
      ? (r: number) => 90 - (r * 180) / (spec.height - 1)
      : (r: number) => 90 - ((r + 0.5) * 180) / spec.height;

  // Scatter every source sample into the output cell it falls in and average.
  // For a same-size grid this reduces to a pure roll — one sample per cell — so
  // the products that need no resampling are untouched by the machinery.
  const sum = new Float64Array(w * h);
  const hits = new Uint32Array(w * h);
  for (let r = 0; r < spec.height; r++) {
    const lat = latOfRow(r);
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    for (let c = 0; c < spec.width; c++) {
      const i = r * spec.width + c;
      const dn = spec.endian === 'msb' ? raw.readInt16BE(i * 2) : raw.readInt16LE(i * 2);
      if (dn === -32768) {
        continue; // NODATA
      }
      let v = dn * spec.metresPerDn;
      // Clamped before averaging, so a coastal cell blends land down to the
      // waterline rather than being dragged below it by the sea bed offshore.
      if (spec.floorMetres !== undefined) {
        v = Math.max(v, spec.floorMetres);
      }
      const lon = lonOfCol(c);
      const u = ((((lon - 180) / 360) % 1) + 1) % 1;
      const x = Math.min(w - 1, Math.floor(u * w));
      sum[y * w + x] += v;
      hits[y * w + x]++;
    }
  }

  let empty = 0;
  let min = Infinity;
  let max = -Infinity;
  const metres = new Float64Array(w * h);
  for (let i = 0; i < metres.length; i++) {
    if (hits[i] === 0) {
      empty++;
      continue;
    }
    const v = sum[i] / hits[i];
    metres[i] = v;
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  if (empty > 0) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: ${empty} output cells received no samples`);
    return null;
  }

  const span = max - min;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < metres.length; i++) {
    const t = Math.round(((metres[i] - min) / span) * 65535);
    rgb[i * 3] = (t >> 8) & 0xff;
    rgb[i * 3 + 1] = t & 0xff;
  }

  await fs.mkdir(SHAPES, { recursive: true });
  const png = encodePng(w, h, rgb);
  await fs.writeFile(outPath, png);
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h}, ${(min / 1000).toFixed(2)}..${(max / 1000).toFixed(2)} km, ${mb(png.length)}`,
    )}`,
  );

  return {
    body: spec.body,
    out: spec.out,
    width: w,
    height: h,
    minKm: min / 1000,
    maxKm: max / 1000,
    credit: spec.credit,
  };
}
