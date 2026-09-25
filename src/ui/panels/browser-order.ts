/** How the body browser orders moons and ranks search results. Pure. */

import type { SimBody } from '../../core/system.ts';
import { fmt, formatDistance } from './format.ts';

/** How the moon list under a planet is ordered. */
export type MoonSort = 'size' | 'name' | 'distance';

export const MOON_SORTS: Array<{ mode: MoonSort; label: string; title: string }> = [
  {
    mode: 'distance',
    label: 'distance',
    title: 'Innermost first, by semi-major axis about its planet',
  },
  { mode: 'size', label: 'size', title: 'Largest first, by mean radius' },
  {
    mode: 'name',
    label: 'name',
    title: 'Alphabetical, with provisional designations in numeric order',
  },
];

/** Semi-major axis about the parent, km. Unknown orbits sort to the end. */
const orbitRadius = (moon: SimBody): number => moon.elements?.a ?? Infinity;

/** Live distance from the parent, km. */
export const localDistance = (body: SimBody): number =>
  Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z);

/**
 * The moons of one body in the chosen order.
 *
 * `moonsOf` hands back a fresh array already sorted largest first, so the
 * size case needs no work at all.
 */
export function sortMoons(moons: SimBody[], sort: MoonSort): SimBody[] {
  if (sort === 'name') {
    // Numeric collation so that S/2004 S 9 precedes S/2004 S 24 rather than
    // following it — half of Saturn's family is still provisional.
    return moons.toSorted((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  if (sort === 'distance') {
    // Semi-major axis rather than where the moon happens to be right now: a
    // live distance would reshuffle the list under the cursor every frame.
    return moons.toSorted((a, b) => orbitRadius(a) - orbitRadius(b));
  }
  return moons;
}

/** The figure on the right of a moon row is whatever the list is ordered by. */
export function moonMeta(moon: SimBody, sort: MoonSort): string {
  if (sort !== 'distance') {
    return `${fmt(moon.radiusKm, 0)} km`;
  }
  const a = moon.elements?.a;
  return a === undefined ? '' : formatDistance(a);
}

export function moonCount(body: SimBody): string {
  const n = body.children.filter((c) => c.type === 'moon').length;
  return n ? `${n} moon${n === 1 ? '' : 's'}` : '';
}

/**
 * Search results: name matches, plus Lagrange points by their subtitle.
 *
 * Lagrange points are not in `bodies` — they are markers, not objects — but
 * they are findable while the layer is on, and their subtitle is searched as
 * well as their name: "L4" alone cannot tell you whose, and "earth" or
 * "lagrange" is how anyone would actually look for them.
 */
export function searchBodies(candidates: SimBody[], query: string): SimBody[] {
  return candidates
    .filter(
      (b) =>
        b.name.toLowerCase().includes(query) ||
        (b.type === 'lagrange' && b.subtitle.toLowerCase().includes(query)),
    )
    .toSorted((a, b) => {
      // Prefer prefix matches, then bigger bodies.
      const ap = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (ap !== bp) {
        return ap - bp;
      }
      return b.radiusKm - a.radiusKm;
    })
    .slice(0, 90);
}
