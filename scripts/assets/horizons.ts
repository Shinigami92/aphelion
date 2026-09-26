/** Satellite state vectors from JPL Horizons, the ephemerides the mean elements describe. */

import type { Vec3 } from '../../src/astro/kepler.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { equatorialToEcliptic } from '../../src/astro/frames.ts';
import { CACHE, exists, UA } from './io.ts';

/** Planetocentric position and velocity at a TDB Julian Date, ecliptic J2000, km and km/s. */
export interface StateVector {
  jd: number;
  r: Vec3;
  v: Vec3;
}

/** NAIF codes of the bodies the satellite table's moons orbit. */
const CENTRE: Record<string, number> = {
  earth: 399,
  mars: 499,
  jupiter: 599,
  saturn: 699,
  uranus: 799,
  neptune: 899,
  pluto: 999,
};

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

function query(code: number, centre: number, jds: ReadonlyArray<number>): string {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${code}'`,
    CENTER: `'500@${centre}'`,
    EPHEM_TYPE: 'VECTORS',
    // ICRF rather than Horizons' own ecliptic, so the rotation into the ecliptic
    // uses the same obliquity as everything else in Aphelion.
    REF_PLANE: 'FRAME',
    REF_SYSTEM: 'ICRF',
    TLIST: `'${jds.join(' ')}'`,
    VEC_TABLE: '2',
    OUT_UNITS: 'KM-S',
    CSV_FORMAT: 'YES',
    OBJ_DATA: 'NO',
  });
  return `${API}?${params.toString()}`;
}

/**
 * Horizons answers too many requests at once with an empty or truncated body, so
 * only a complete answer is cached, and a failed one is retried after a pause.
 */
async function fetchAnswer(url: string, dest: string): Promise<string | null> {
  if (await exists(dest)) {
    return fs.readFile(dest, 'utf8');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const text = res.ok ? await res.text() : '';
      if (text.includes('$$EOE') || text.includes('No matches found')) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, text);
        return text;
      }
    } catch {
      // Retried below; a moon Horizons never answers for keeps its table phase.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2000 * (attempt + 1));
    });
  }
  return null;
}

/**
 * A satellite's states at the given instants, in the same order, or null when
 * Horizons has no such moon or not for all of those dates.
 *
 * The target is checked by code, not trusted: Horizons resolves an integer it has
 * no satellite for to a minor planet instead, which is what happens to the
 * newest Uranian moon, S/2025 U 1 (75052). It answers with asteroid 1999 UM50,
 * 3 billion km away.
 */
export async function horizonsStates(
  code: number,
  planet: string,
  jds: ReadonlyArray<number>,
): Promise<StateVector[] | null> {
  const centre = CENTRE[planet];
  if (centre === undefined) {
    return null;
  }
  // Named by the first date and the count: the dates are derived from the row, so
  // a changed row asks again rather than reading someone else's answer.
  const dest = path.join(CACHE, 'horizons', `${code}@${jds[0]}x${jds.length}.txt`);
  const text = await fetchAnswer(query(code, centre, jds), dest);
  const target = text === null ? null : /Target body name:.*$/mu.exec(text);
  if (text === null || target?.[0].includes(`(${code})`) !== true) {
    return null;
  }
  const body = /\$\$SOE\s*\n([\s\S]*?)\$\$EOE/u.exec(text)?.[1] ?? '';
  const states: StateVector[] = [];
  for (const line of body.split('\n')) {
    const cols = line.split(',').map((c) => Number(c.trim()));
    if (cols.length < 8 || [0, 2, 3, 4, 5, 6, 7].some((i) => !Number.isFinite(cols[i]))) {
      continue;
    }
    states.push({
      jd: cols[0],
      r: equatorialToEcliptic({ x: cols[2], y: cols[3], z: cols[4] }),
      v: equatorialToEcliptic({ x: cols[5], y: cols[6], z: cols[7] }),
    });
  }
  return states.length === jds.length ? states : null;
}
