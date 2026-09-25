/** Ring numbers the particle patch needs: drawn size, local gravity, local scale. */

import type { ScaleModel } from '../../core/scale.ts';
import type { SimBody } from '../../core/system.ts';
import type { RingSpec } from '../../data/bodies.ts';
import { SCENE_UNIT_KM } from '../../core/constants.ts';

/**
 * Drawn radius of a ring particle, km.
 *
 * Pure exaggeration, and by a long way: real ring particles run from
 * centimetres to about ten metres, which is far below a pixel at any distance
 * this app can put you at, so drawing them honestly would draw nothing. The
 * size is pinned to the ring's own width instead, which keeps the field
 * looking similar whether you are in Saturn's main rings or Uranus's epsilon.
 */
export function ringParticleSizeKm(spec: RingSpec): number {
  return Math.max((spec.outerKm - spec.innerKm) * 2e-4, 0.4);
}

/** GM in km^3/s^2, from the body's mass, for the local orbital rate. */
export function gravitationalParameter(body: SimBody): number {
  const massKg = body.spec?.facts.mass ?? 0;
  // 6.674e-20 is G in km^3 kg^-1 s^-2.
  const gm = massKg * 6.6743e-20;
  return gm > 0 ? gm : 3.7931207e7;
}

/**
 * Local kilometres per scene unit at a given rendered ring radius.
 *
 * Inverts the radial remap numerically rather than in closed form: the blended
 * power law has no analytic inverse, and this runs once per frame rather than
 * per vertex, so a short bisection is cheaper to trust than to be clever about.
 */
export function ringKmPerUnit(
  radiusUnits: number,
  parentRadiusKm: number,
  scale: ScaleModel,
): number {
  if (radiusUnits <= 0) {
    return SCENE_UNIT_KM;
  }
  let lo = 1;
  let hi = parentRadiusKm * 400;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) * 0.5;
    if (scale.satelliteDistance(mid, parentRadiusKm) < radiusUnits) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return ((lo + hi) * 0.5) / radiusUnits;
}
