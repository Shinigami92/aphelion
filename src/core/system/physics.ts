/** Derived physical quantities the info panel shows. */

import type { SimBody } from '../system.ts';
import { GM } from '../constants.ts';
import { isPlanetKey, length } from './body.ts';

/** Exported for the info panel: escape velocity from GM and radius. */
export function escapeVelocity(gmKm3S2: number, radiusKm: number): number {
  return Math.sqrt((2 * gmKm3S2) / radiusKm);
}

/** Hill sphere radius, km — the practical edge of a planet's gravitational reach. */
export function hillRadius(body: SimBody): number | null {
  if (!body.spec || !isPlanetKey(body.spec.key)) {
    return null;
  }
  const gmPlanet = GM[body.spec.key as keyof typeof GM];
  if (!gmPlanet) {
    return null;
  }
  const a = length(body.helioKm);
  return a * Math.cbrt(gmPlanet / (3 * GM.sun));
}
