/** Orbit outlines for the mini-map, sampled from the same elements the 3D view uses. */

import type { Basis } from '../../astro/frames.ts';
import type { Vec3 } from '../../astro/kepler.ts';
import type { SimBody, SolarSystem } from '../../core/system.ts';
import { applyBasis } from '../../astro/frames.ts';
import { sampleOrbit } from '../../astro/kepler.ts';

export const ORBIT_SAMPLES = 128;

export class OrbitSampler {
  private orbitCache = new Map<string, { points: Float64Array; jd: number }>();
  private scratch: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private system: SolarSystem) {}

  /**
   * Orbit sample points in the parent's frame, cached until the elements
   * meaningfully precess (a day of simulated time is plenty of slack here).
   */
  points(body: SimBody): Float64Array | null {
    if (!body.elements) {
      return null;
    }
    const cached = this.orbitCache.get(body.key);
    if (cached && Math.abs(cached.jd - this.system.jdTT) < 1) {
      return cached.points;
    }

    const raw = sampleOrbit(body.elements, ORBIT_SAMPLES, this.system.jdTT);
    const out = new Float64Array(ORBIT_SAMPLES * 3);
    const basis: Basis = body.basis;
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      applyBasis(basis, raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], this.scratch);
      out[i * 3] = this.scratch.x;
      out[i * 3 + 1] = this.scratch.y;
      out[i * 3 + 2] = this.scratch.z;
    }
    this.orbitCache.set(body.key, { points: out, jd: this.system.jdTT });
    return out;
  }
}
