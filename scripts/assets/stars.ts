/** The Hipparcos stars Aphelion draws as points. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download } from './io.ts';

// ---------------------------------------------------------------------------
// 6. Hipparcos star catalogue  (ESA 1997, via CDS)
//
// The stars Aphelion draws as points, complementing the SVS deep-sky texture
// above: that image has the Hipparcos and Tycho stars removed, and these put
// them back as real point sources rather than baked texels. Sharp at any
// display resolution, correctly coloured from B-V, and -- because the clock
// spans 1600 to 2500 -- carrying their proper motions.
//
// Output is a packed binary in public/sky/, not a TypeScript literal: 41k stars
// is ~540 KB packed and would be several megabytes as source text. The
// generated module beside it records the layout and the count, so a stale
// binary is caught by a mismatch rather than by a garbled sky.
// ---------------------------------------------------------------------------

const HIPPARCOS_URL = 'https://cdsarc.cds.unistra.fr/ftp/I/239/hip_main.dat';

/**
 * Faintest star to store.
 *
 * Hipparcos is complete to V = 7.3 everywhere and to about 9 away from the
 * galactic plane, so 8.0 is drawn from a near-complete sample and the thinning
 * that does exist is concentrated in the plane -- exactly where the deep-sky
 * texture is brightest and hides it. It is also the magnitude at which NASA
 * switched from Hipparcos to Tycho when building that texture, so the two
 * layers meet where the source data does.
 */
export const STAR_MAG_LIMIT = 8.0;

/** Catalogue epoch of the Hipparcos astrometry; positions are propagated to J2000. */
export const HIPPARCOS_EPOCH = 1991.25;

export const STAR_FILE = 'stars.bin';

export const STAR_MAGIC = 0x52545341; // 'ASTR' little-endian

export interface Star {
  /** Right ascension and declination at J2000.0, radians. */
  ra: number;
  dec: number;
  /** Proper motion, mas/yr; pmRA already carries the cos(dec) factor. */
  pmRA: number;
  pmDec: number;
  vmag: number;
  rgb: [number, number, number];
}

/**
 * Effective temperature from the Johnson B-V colour index (Ballesteros 2012).
 *
 * Reproduces the Sun at 5757 K from B-V = 0.656 (true value 5772) and Rigel at
 * 10516 K from -0.03 (about 11000). The clamp matters: the second term has a
 * pole at B-V = -0.674, and a handful of catalogue entries carry colours that
 * unphysical.
 */
function temperatureFromBV(bv: number): number {
  const c = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/** One piecewise Gaussian of the colour-matching fit: width s1 below the peak, s2 above. */
const lobe = (x: number, mu: number, s1: number, s2: number): number => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/**
 * Blackbody colour, as a multi-lobe Gaussian fit to the CIE 1931 colour
 * matching functions (Wyman, Sloan & Shirley 2013) integrated against Planck's
 * law, then converted to sRGB primaries.
 *
 * Done here rather than in the shader because it is a per-star constant, and
 * because getting it wrong is invisible on screen but obvious in a table:
 * B stars must come out blue-white and M stars orange, never red.
 */
function colourFromTemperature(kelvin: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let nm = 360; nm <= 830; nm += 2) {
    const l = nm * 1e-9;
    // Planck's law, spectral radiance per wavelength. The leading constants
    // cancel in the normalisation below, but are kept so the units are real.
    const planck = 3.7417718e-16 / (l ** 5 * (Math.exp(1.4387769e-2 / (l * kelvin)) - 1));
    X +=
      planck *
      (1.056 * lobe(nm, 599.8, 37.9, 31.0) +
        0.362 * lobe(nm, 442.0, 16.0, 26.7) -
        0.065 * lobe(nm, 501.1, 20.4, 26.2));
    Y += planck * (0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1));
    Z += planck * (1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8));
  }
  const sum = X + Y + Z || 1;
  X /= sum;
  Y /= sum;
  Z /= sum;

  // XYZ -> linear sRGB (IEC 61966-2-1, D65).
  const linear = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ].map((c) => Math.max(0, c));

  // Store chromaticity only, normalised so the strongest channel is full. How
  // *bright* the star is comes from its magnitude, and the renderer divides
  // this colour by its own luminance so the two never fight.
  const peak = Math.max(linear[0], linear[1], linear[2]) || 1;
  const encode = (c: number): number => {
    const u = Math.max(0, Math.min(1, c / peak));
    const encoded = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
    return Math.round(255 * encoded);
  };
  return [encode(linear[0]), encode(linear[1]), encode(linear[2])];
}

export async function buildStarCatalogue(): Promise<Star[] | null> {
  const dest = path.join(CACHE, 'hip_main.dat');
  if (!(await download(HIPPARCOS_URL, dest, 'Hipparcos main catalogue (I/239)'))) {
    return null;
  }
  const text = await fs.readFile(dest, 'utf8');

  const DEG = Math.PI / 180;
  const MAS = (1 / 3_600_000) * DEG;
  // Hipparcos positions are given for 1991.25; everything else in Aphelion is
  // J2000, so the astrometry is propagated forward once, here.
  const toJ2000 = 2000.0 - HIPPARCOS_EPOCH;

  const stars: Star[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    // Fixed columns, per the catalogue ReadMe: Vmag H5, RAdeg H8, DEdeg H9,
    // pmRA H12, pmDE H13, B-V H37.
    if (line.length < 251) {
      continue;
    }
    const vmag = Number(line.slice(41, 46));
    const raDeg = Number(line.slice(51, 63));
    const decDeg = Number(line.slice(64, 76));
    if (!Number.isFinite(vmag) || !Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
      skipped++;
      continue;
    }
    if (line.slice(51, 63).trim() === '' || line.slice(41, 46).trim() === '') {
      skipped++;
      continue;
    }
    if (vmag > STAR_MAG_LIMIT) {
      continue;
    }

    const pmRA = Number(line.slice(87, 95)) || 0;
    const pmDec = Number(line.slice(96, 104)) || 0;
    const bvRaw = line.slice(245, 251).trim();
    // A star with no measured colour is almost always a faint one; A0 (B-V = 0)
    // is the least committal guess and reads as plain white.
    const bv = bvRaw === '' ? 0 : Number(bvRaw);

    // Propagate as a vector rather than by adding to RA and dividing by cos(dec):
    // Polaris sits at dec 89.26, where that division amplifies its 44 mas/yr into
    // nonsense, and the vector form is singular nowhere.
    const ra = raDeg * DEG;
    const dec = decDeg * DEG;
    const cd = Math.cos(dec);
    const sd = Math.sin(dec);
    const ca = Math.cos(ra);
    const sa = Math.sin(ra);
    // East and north unit vectors at the star, in equatorial coordinates.
    const east = [-sa, ca, 0];
    const north = [-sd * ca, -sd * sa, cd];
    const p = [cd * ca, cd * sa, sd].map(
      (c, i) => c + (pmRA * east[i] + pmDec * north[i]) * MAS * toJ2000,
    );
    const len = Math.hypot(p[0], p[1], p[2]) || 1;

    stars.push({
      ra: Math.atan2(p[1], p[0]),
      dec: Math.asin(Math.max(-1, Math.min(1, p[2] / len))),
      pmRA,
      pmDec,
      vmag,
      rgb: colourFromTemperature(temperatureFromBV(Number.isFinite(bv) ? bv : 0)),
    });
  }

  if (skipped) {
    console.log(`  ${C.dim('skip   ')} ${skipped} rows without usable astrometry`);
  }
  return stars.length > 0 ? stars : null;
}

/** Proper motion, mas/yr, rounded into the signed 16-bit block it is stored in. */
export const clampPm = (v: number): number => Math.max(-32767, Math.min(32767, Math.round(v)));
