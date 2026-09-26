/** The JPL satellite elements, and the satellites module generated from them. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { C, fetchText, GENERATED } from './io.ts';
import { epochStringToJd, KNOWN_RADII, NOMINAL_RADIUS, num, tableRows } from './jpl.ts';
import { repairFromHorizons } from './repair.ts';

interface SatelliteRecord {
  name: string;
  code: number;
  planet: string;
  frame: 'ecliptic' | 'equatorial' | 'laplace';
  epoch: number;
  a: number;
  e: number;
  argPeri: number;
  m0: number;
  inc: number;
  node: number;
  period: number;
  apsisPeriod: number | null;
  nodePeriod: number | null;
  poleRa: number | null;
  poleDec: number | null;
  radius: number;
  radiusEstimated: boolean;
  gm: number | null;
  density: number | null;
  meanMotion: number | null;
  /** What had to come from Horizons instead of JPL's table, if anything. */
  fromHorizons?: string;
}

/** A measurement cell reads "value sigma reference"; the value is its first token. */
const firstToken = (s: string | undefined): number | null => num(s?.trim().split(/\s+/u)[0]);

export async function buildSatelliteData(): Promise<SatelliteRecord[] | null> {
  const elemHtml = await fetchText(
    'https://ssd.jpl.nasa.gov/sats/elem/',
    'sats_elem.html',
    'JPL satellite mean elements',
  );
  const physHtml = await fetchText(
    'https://ssd.jpl.nasa.gov/sats/phys_par/',
    'sats_phys.html',
    'JPL satellite physical parameters',
  );
  if (elemHtml === null || elemHtml === '') {
    return null;
  }

  // Physical parameters keyed by NAIF code. Each measurement cell reads
  // "value sigma reference", so the first token is the number we want.
  const phys = new Map<
    number,
    { gm: number | null; radius: number | null; density: number | null }
  >();
  if (physHtml !== null && physHtml !== '') {
    for (const row of tableRows(physHtml, 'sat_phys_par')) {
      const code = num(row[2]);
      if (code === null) {
        continue;
      }
      phys.set(code, {
        gm: firstToken(row[3]),
        radius: firstToken(row[4]),
        density: firstToken(row[5]),
      });
    }
  }

  const records: SatelliteRecord[] = [];
  const seen = new Set<number>();

  for (const row of tableRows(elemHtml, 'sat_elem')) {
    // ID Planet Satellite Code Ephemeris Frame Epoch a e w M i node P Papsis Pnode RA Dec Tilt Ref
    const planet = row[1] ?? '';
    const name = row[2] ?? '';
    const code = num(row[3]);
    const frameRaw = (row[5] ?? '').toLowerCase();
    const a = num(row[7]);
    const e = num(row[8]);
    const period = num(row[13]);

    if (code === null || !name || a === null || e === null || period === null) {
      continue;
    }
    // The table lists several ephemeris solutions per moon; JPL orders them
    // best-first, so keep the first and drop duplicates.
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);

    const frame: SatelliteRecord['frame'] = frameRaw.includes('laplace')
      ? 'laplace'
      : frameRaw.includes('equator')
        ? 'equatorial'
        : 'ecliptic';

    const p = phys.get(code);
    const published = p?.radius ?? KNOWN_RADII[name] ?? null;

    records.push({
      name,
      code,
      planet,
      frame,
      epoch: epochStringToJd(row[6] ?? '2000-01-01.5'),
      a,
      e,
      argPeri: num(row[9]) ?? 0,
      m0: num(row[10]) ?? 0,
      inc: num(row[11]) ?? 0,
      node: num(row[12]) ?? 0,
      period,
      meanMotion: null,
      apsisPeriod: num(row[14]),
      nodePeriod: num(row[15]),
      poleRa: num(row[16]),
      poleDec: num(row[17]),
      radius: published ?? NOMINAL_RADIUS[planet] ?? 2,
      radiusEstimated: published === null,
      gm: p?.gm ?? null,
      density: p?.density ?? null,
    });
  }
  await repairFromHorizons(records);
  return records;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export const r6 = (n: number): string => {
  const v = Number(n.toFixed(6));
  return Object.is(v, -0) ? '0' : String(v);
};

const orNull = (n: number | null): string => (n === null ? 'null' : r6(n));

export async function writeSatelliteModule(records: SatelliteRecord[]): Promise<void> {
  const byPlanet = new Map<string, number>();
  for (const r of records) {
    byPlanet.set(r.planet, (byPlanet.get(r.planet) ?? 0) + 1);
  }
  const summary = [...byPlanet.entries()].map(([p, n]) => `${p} ${n}`).join(', ');
  const estimated = records.filter((r) => r.radiusEstimated).length;
  const repaired = records.filter((r) => r.fromHorizons !== undefined).length;

  const lines = records.map((r) => {
    const fields = [
      `name: ${JSON.stringify(r.name)}`,
      `code: ${r.code}`,
      `planet: ${JSON.stringify(r.planet.toLowerCase())}`,
      `frame: ${JSON.stringify(r.frame)}`,
      `epoch: ${r6(r.epoch)}`,
      `a: ${r6(r.a)}`,
      `e: ${r6(r.e)}`,
      `argPeri: ${r6(r.argPeri)}`,
      `m0: ${r6(r.m0)}`,
      `inc: ${r6(r.inc)}`,
      `node: ${r6(r.node)}`,
      `period: ${r6(r.period)}`,
      `meanMotion: ${orNull(r.meanMotion)}`,
      `apsisPeriod: ${orNull(r.apsisPeriod)}`,
      `nodePeriod: ${orNull(r.nodePeriod)}`,
      `poleRa: ${orNull(r.poleRa)}`,
      `poleDec: ${orNull(r.poleDec)}`,
      `radius: ${r6(r.radius)}`,
      `radiusEstimated: ${r.radiusEstimated}`,
      `gm: ${orNull(r.gm)}`,
      `density: ${orNull(r.density)}`,
    ];
    const note = r.fromHorizons === undefined ? '' : ` // from ${r.fromHorizons}`;
    return `  { ${fields.join(', ')} },${note}`;
  });

  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Satellite mean orbital elements and physical parameters from JPL Solar System
 * Dynamics (https://ssd.jpl.nasa.gov/sats/elem/ and .../phys_par/).
 *
 * ${records.length} satellites: ${summary}.
 * ${estimated} have no published radius and use a nominal size
 * (\`radiusEstimated: true\`).
 *
 * ${repaired} take their phase (node, periapsis, mean anomaly), their nodal
 * period or their mean motion from JPL Horizons, because the table's put them
 * far from the ephemeris it names (see scripts/assets/repair.ts). Their shape,
 * apsidal precession and plane are JPL's.
 *
 * Angles are degrees, distances kilometres, periods days (orbital) or years
 * (apsidal/nodal precession). \`frame\` selects the plane the angles refer to;
 * \`poleRa\`/\`poleDec\` define the Laplace plane where applicable.
 */

export interface SatelliteData {
  name: string
  /** NAIF/JPL body code. */
  code: number
  /** Lowercase parent planet key. */
  planet: string
  frame: 'ecliptic' | 'equatorial' | 'laplace'
  /** Epoch of the elements, Julian Date (TDB). */
  epoch: number
  /** Semi-major axis, km. */
  a: number
  e: number
  /** Argument of periapsis, degrees. */
  argPeri: number
  /** Mean anomaly at epoch, degrees. */
  m0: number
  /** Inclination to the reference plane, degrees. */
  inc: number
  /** Longitude of ascending node, degrees. */
  node: number
  /** Sidereal period, days. */
  period: number
  /** Mean-anomaly rate fitted to Horizons, degrees per day; null for 360/period. */
  meanMotion: number | null
  /** Apsidal precession period, years. */
  apsisPeriod: number | null
  /** Nodal regression period, years. */
  nodePeriod: number | null
  /** Laplace-plane pole right ascension, degrees. */
  poleRa: number | null
  /** Laplace-plane pole declination, degrees. */
  poleDec: number | null
  /** Mean radius, km. */
  radius: number
  radiusEstimated: boolean
  /** GM, km^3/s^2. */
  gm: number | null
  /** Mean density, g/cm^3. */
  density: number | null
}

export const SATELLITES: readonly SatelliteData[] = [
${lines.join('\n')}
]
`;
  await fs.mkdir(GENERATED, { recursive: true });
  await fs.writeFile(path.join(GENERATED, 'satellites.ts'), src);
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/satellites.ts ${C.dim(`(${records.length} moons, ${estimated} estimated radii)`)}`,
  );
}
