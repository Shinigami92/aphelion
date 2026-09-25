/**
 * What the SolarSystem specs share: one solved system per test file, the
 * reference instant, and the vector helpers their assertions use.
 */

import type { Vec3 } from '../src/astro/kepler.ts';
import type { SimBody } from '../src/core/system.ts';
import { parseUtc } from '../src/astro/calendar.ts';
import { jdUtcToTt } from '../src/astro/timescales.ts';
import { ScaleModel } from '../src/core/scale.ts';
import { SolarSystem } from '../src/core/system.ts';

// NaN rather than a cast: should the fixture ever stop parsing, every
// comparison against it fails instead of quietly testing `null`.
export const JD_TT = jdUtcToTt(parseUtc('2024-04-08 18:17:16') ?? Number.NaN);

export const settledAt = (mode: 'true' | 'explore'): ScaleModel => {
  const s = new ScaleModel();
  s.setMode(mode);
  s.snap();
  return s;
};

export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

export const unit = (v: Vec3): Vec3 => {
  const r = length(v);
  return { x: v.x / r, y: v.y / r, z: v.z / r };
};

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/**
 * Radians. `acos` near 1 cannot resolve much below sqrt(epsilon), about 1.5e-8,
 * so a truly parallel pair still reads a few times that; a real sideways shift
 * would be orders of magnitude larger.
 */
export const RADIAL_TOLERANCE = 1e-6;

export const angleBetween = (a: Vec3, b: Vec3): number => {
  const ua = unit(a);
  const ub = unit(b);
  return Math.acos(Math.min(1, Math.max(-1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z)));
};

/** Six significant figures: tight enough to catch a real change, loose enough to survive libm. */
export const sig = (x: number): number => Number(x.toPrecision(6));
export const sigVec = (v: Vec3): [number, number, number] => [sig(v.x), sig(v.y), sig(v.z)];

/** Built once per test file; the specs call `update` on it themselves. */
export const system = new SolarSystem();

export const body = (key: string): SimBody => {
  const found = system.byKey.get(key);
  if (!found) {
    throw new Error(`no body '${key}'`);
  }
  return found;
};
