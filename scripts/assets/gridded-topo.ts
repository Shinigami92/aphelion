/** Titan's gridded topography, read out of a PDS archive by byte range. */

import type { ReliefResult } from './relief.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { C, CACHE, download, exists, mb, SHAPES } from './io.ts';
import { encodePng } from './png.ts';
import { fetchZipEntries, unzipEntry } from './zip.ts';

/**
 * `parseFloat`, which stops at the first non-numeric character. PDS values
 * carry trailing units (`2.0<PIX/DEG>`) and MPC's fixed-width fields can be
 * blank, where `Number()` would give NaN and 0 respectively; the JPL table
 * cells keep the same loose parse they have always had.
 */
export function parseLeadingFloat(text: string): number {
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- Number() rejects trailing units and reads blank fields as 0
  return Number.parseFloat(text);
}

/** Read a PDS3 keyword. Values carry units (`2.0<PIX/DEG>`), so parse loosely. */
function pdsValue(label: string, key: string): string | null {
  const m = label.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'mu'));
  return m ? m[1].trim() : null;
}

function pdsNumber(label: string, key: string): number {
  const raw = pdsValue(label, key);
  const n = raw === null ? NaN : parseLeadingFloat(raw);
  if (!Number.isFinite(n)) {
    // oxlint-disable-next-line unicorn/prefer-type-error -- a malformed label, not a type error
    throw new Error(`PDS label has no numeric ${key}`);
  }
  return n;
}

interface GriddedTopoSpec {
  body: string;
  out: string;
  /** Zip archive, on a host that serves range requests. */
  url: string;
  /** Name fragments of the PDS3 images to merge; together they must tile the globe. */
  entries: string[];
  /** Output grid. */
  width: number;
  height: number;
  credit: string;
  note: string;
}

export const GRIDDED_TOPO: GriddedTopoSpec[] = [
  {
    body: 'moon:Titan',
    out: 'titan_relief.png',
    url: 'https://asc-astropedia.s3.us-west-2.amazonaws.com/Titan/Cassini/GTDR/gtdr-data.zip',
    // GTI = the tensioned-spline interpolation through every Cassini RADAR
    // altimetry and SARTopo track from flybys TA to T77; EB = 2 px/deg; N090
    // and N270 are the two hemispheres, named for the west longitude at their
    // centres. The archive's own GTDR_info.pdf spells the naming out, which is
    // how the interpolated model was picked out of twenty-odd ellipsoid and
    // spherical-harmonic fits sitting beside it.
    entries: ['GTIEB00N090_T077_V01.IMG', 'GTIEB00N270_T077_V01.IMG'],
    // 2 px/deg globally, so the output grid is the source grid: no resampling.
    width: 720,
    height: 360,
    credit: 'Cassini RADAR GTDR (Lorenz et al. 2013) — USGS Astrogeology',
    note: 'Cassini RADAR altimetry + SARTopo, 2 px/deg',
  },
];

/**
 * Merge PDS3 equirectangular float grids into one elevation map.
 *
 * Everything about where a sample sits comes out of the label: PDS states the
 * projection as an offset and a resolution, so
 *
 *   latitude  = (LINE_PROJECTION_OFFSET + 1 - line) / MAP_RESOLUTION
 *   longitude = CENTER_LONGITUDE -/+ (sample - SAMPLE_PROJECTION_OFFSET - 1) / MAP_RESOLUTION
 *
 * with the sign set by POSITIVE_LONGITUDE_DIRECTION. Both are checked against
 * the label's own declared latitude and longitude bounds before anything is
 * written, so a misread offset fails here rather than producing a mirrored
 * world that still looks like a world.
 *
 * Elevations stay on the datum the product publishes them against. Aphelion's
 * radius for the body may differ by a few hundred metres, but that is a uniform
 * change of sphere size, not of shape — and leaving the numbers as published is
 * what lets `pnpm validate` compare the map's mean radius against the entirely
 * independent JPL figure.
 */
export async function buildGriddedTopo(spec: GriddedTopoSpec): Promise<ReliefResult | null> {
  const cachePath = path.join(CACHE, path.basename(spec.url));
  let entries = (await exists(cachePath)) ? null : await fetchZipEntries(spec.url, spec.entries);
  if (!entries) {
    // No ranges, or the archive is already cached in full from an earlier run.
    console.log(`  ${C.dim('       ')} ${spec.out}: reading the whole archive`);
    if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
      return null;
    }
    const whole = await fs.readFile(cachePath);
    entries = new Map();
    for (const name of spec.entries) {
      const entry = unzipEntry(whole, name);
      if (!entry) {
        console.log(`  ${C.red('bad    ')} ${spec.out}: no zip entry matching ${name}`);
        return null;
      }
      entries.set(name, entry);
    }
  }

  const w = spec.width;
  const h = spec.height;
  const sum = new Float64Array(w * h);
  const hits = new Uint32Array(w * h);

  for (const name of spec.entries) {
    // The archive stores each image gzipped inside the zip.
    const img = gunzipSync(entries.get(name)!);
    const label = img.toString('latin1', 0, Math.min(img.length, 32768));

    const recordBytes = pdsNumber(label, 'RECORD_BYTES');
    const labelRecords = pdsNumber(label, 'LABEL_RECORDS');
    const lines = pdsNumber(label, 'LINES');
    const samples = pdsNumber(label, 'LINE_SAMPLES');
    const bits = pdsNumber(label, 'SAMPLE_BITS');
    const type = pdsValue(label, 'SAMPLE_TYPE');
    // PC_REAL is little-endian IEEE 754. Refuse anything else rather than
    // reading a different layout as if it were this one.
    if (type !== 'PC_REAL' || bits !== 32) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} is ${bits}-bit ${type}, expected 32-bit PC_REAL`,
      );
      return null;
    }
    const dataStart = labelRecords * recordBytes;
    if (img.length < dataStart + lines * samples * 4) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} is ${img.length} bytes, too short for ${samples}x${lines}`,
      );
      return null;
    }

    const res = pdsNumber(label, 'MAP_RESOLUTION');
    const centreLon = pdsNumber(label, 'CENTER_LONGITUDE');
    const lineOffset = pdsNumber(label, 'LINE_PROJECTION_OFFSET');
    const sampleOffset = pdsNumber(label, 'SAMPLE_PROJECTION_OFFSET');
    const positive = pdsValue(label, 'POSITIVE_LONGITUDE_DIRECTION');
    if (positive !== 'WEST' && positive !== 'EAST') {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} has POSITIVE_LONGITUDE_DIRECTION ${positive}`,
      );
      return null;
    }
    const sign = positive === 'WEST' ? -1 : 1;

    // Samples are 1-based in the PDS formulae. `lonOf` stays in the product's
    // own direction so it can be checked against the label; the conversion to
    // east longitude happens once, afterwards.
    const latOf = (line: number) => (lineOffset + 1 - line) / res;
    const lonOf = (sample: number) => centreLon + (sign * (sample - sampleOffset - 1)) / res;
    const eastOf = (lon: number) => (((positive === 'WEST' ? -lon : lon) % 360) + 360) % 360;

    // The label states its extent independently of the offsets that produce it,
    // so the two have to agree. This is the only warning either file gives
    // before a silently mirrored world, and the two hemispheres disagree about
    // SAMPLE_PROJECTION_OFFSET by 360 pixels, which is exactly the kind of thing
    // one would otherwise get half right.
    const halfCell = 0.5 / res;
    const spans = (a: number, b: number, lo: number, hi: number) =>
      Math.abs(Math.min(a, b) - halfCell - lo) < 1e-3 &&
      Math.abs(Math.max(a, b) + halfCell - hi) < 1e-3;
    if (
      !spans(
        latOf(1),
        latOf(lines),
        pdsNumber(label, 'MINIMUM_LATITUDE'),
        pdsNumber(label, 'MAXIMUM_LATITUDE'),
      )
    ) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} spans ${latOf(lines).toFixed(2)}..${latOf(1).toFixed(2)}N,` +
          ` label declares ${pdsNumber(label, 'MINIMUM_LATITUDE')}..${pdsNumber(label, 'MAXIMUM_LATITUDE')}`,
      );
      return null;
    }
    // A whole-globe product declares both bounds equal and the check says
    // nothing; these hemispheres declare real edges, which is the case worth
    // catching.
    const lonLo = pdsNumber(label, 'EASTERNMOST_LONGITUDE');
    const lonHi = pdsNumber(label, 'WESTERNMOST_LONGITUDE');
    if (
      lonLo !== lonHi &&
      !spans(lonOf(1), lonOf(samples), Math.min(lonLo, lonHi), Math.max(lonLo, lonHi))
    ) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} spans ${lonOf(1).toFixed(2)}..${lonOf(samples).toFixed(2)}` +
          ` ${positive}, label declares ${lonLo}..${lonHi}`,
      );
      return null;
    }

    const missing = Number.parseInt(
      (pdsValue(label, 'MISSING_CONSTANT') ?? '').replaceAll(/^16#|#$/gu, ''),
      16,
    );
    for (let line = 1; line <= lines; line++) {
      const lat = latOf(line);
      const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
      for (let s = 1; s <= samples; s++) {
        const at = dataStart + ((line - 1) * samples + (s - 1)) * 4;
        if (Number.isFinite(missing) && img.readUInt32LE(at) === missing) {
          continue;
        }
        const u = ((eastOf(lonOf(s)) - 180) / 360 + 1) % 1;
        const x = Math.min(w - 1, Math.floor(u * w));
        sum[y * w + x] += img.readFloatLE(at);
        hits[y * w + x]++;
      }
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
  await fs.writeFile(path.join(SHAPES, spec.out), png);
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
