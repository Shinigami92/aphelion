/** The Minor Planet Center catalogues, and the small-bodies module generated from them. */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { parseLeadingFloat } from './gridded-topo.ts';
import { C, CACHE, download, GENERATED } from './io.ts';
import { gregorianToJd } from './jpl.ts';
import { r6 } from './satellites.ts';

// ---------------------------------------------------------------------------
// 4. Minor Planet Center orbit catalogues
// ---------------------------------------------------------------------------

const PACK_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

/** MPC packed epoch, e.g. `K2669` -> Julian Date. */
function unpackEpoch(packed: string): number {
  if (packed.length < 5) {
    return 2451545.0;
  }
  const c = packed[0];
  const century = c === 'I' ? 18 : c === 'J' ? 19 : 20;
  const year = century * 100 + Number(packed.slice(1, 3));
  const month = PACK_CHARS.indexOf(packed[3]);
  const day = PACK_CHARS.indexOf(packed[4]);
  if (month < 1 || day < 1 || !Number.isFinite(year)) {
    return 2451545.0;
  }
  return gregorianToJd(year, month, day);
}

interface SmallBody {
  name: string;
  h: number;
  a: number;
  e: number;
  inc: number;
  node: number;
  argPeri: number;
  m0: number;
  epoch: number;
  group: string;
}

/**
 * Classify by semi-major axis and eccentricity. These are the dynamical
 * families the belts are actually made of, and the renderer colours both the
 * catalogued bodies and the background swarms by them.
 */
function classify(a: number, e: number): string {
  const q = a * (1 - e);
  if (a < 2.0) {
    return q < 1.3 ? 'near-earth' : 'inner-belt';
  }
  if (a < 2.5) {
    return 'inner-belt';
  }
  if (a < 2.82) {
    return 'mid-belt';
  }
  if (a < 3.28) {
    return 'outer-belt';
  }
  if (a < 3.7) {
    return 'cybele';
  }
  if (a < 4.6) {
    return 'hilda';
  }
  if (a < 5.5) {
    return 'jupiter-trojan';
  }
  if (a < 30.1) {
    return 'centaur';
  }
  if (a < 39.4) {
    return 'plutino';
  }
  if (a < 48) {
    return e > 0.24 ? 'scattered' : 'classical-kbo';
  }
  if (a < 100) {
    return 'scattered';
  }
  return 'detached';
}

function parseMpcLine(line: string): SmallBody | null {
  if (line.length < 103) {
    return null;
  }
  const h = parseLeadingFloat(line.slice(8, 13));
  const m0 = parseLeadingFloat(line.slice(26, 35));
  const argPeri = parseLeadingFloat(line.slice(37, 46));
  const node = parseLeadingFloat(line.slice(48, 57));
  const inc = parseLeadingFloat(line.slice(59, 68));
  const e = parseLeadingFloat(line.slice(69, 79));
  const a = parseLeadingFloat(line.slice(92, 103));

  if (![m0, argPeri, node, inc, e, a].every(Number.isFinite)) {
    return null;
  }
  if (a <= 0 || e < 0 || e >= 1) {
    return null;
  }

  // Readable designation sits in a fixed field near the end of the record.
  let name = line.slice(166, 194).trim();
  if (!name) {
    name = line.slice(0, 7).trim();
  }
  // "(1) Ceres" -> "Ceres"; bare provisional designations keep their form.
  const paren = /^\((\d+)\)\s*(.*)$/u.exec(name);
  if (paren) {
    name = paren[2].trim() || `(${paren[1]})`;
  }

  return {
    name,
    h: Number.isFinite(h) ? h : 99,
    a,
    e,
    inc,
    node,
    argPeri,
    m0,
    epoch: unpackEpoch(line.slice(20, 25)),
    group: classify(a, e),
  };
}

/** Keep the brightest (hence largest) N per dynamical family. */
function topPerGroup(bodies: SmallBody[], quotas: Record<string, number>): SmallBody[] {
  const byGroup = new Map<string, SmallBody[]>();
  for (const b of bodies) {
    const list = byGroup.get(b.group);
    if (list) {
      list.push(b);
    } else {
      byGroup.set(b.group, [b]);
    }
  }
  const out: SmallBody[] = [];
  for (const [group, list] of byGroup) {
    const quota = quotas[group] ?? 0;
    if (quota <= 0) {
      continue;
    }
    list.sort((x, y) => x.h - y.h);
    out.push(...list.slice(0, quota));
  }
  out.sort((x, y) => x.h - y.h);
  return out;
}

export async function buildSmallBodyData(): Promise<SmallBody[] | null> {
  const distantPath = path.join(CACHE, 'Distant.txt');
  const mpcorbPath = path.join(CACHE, 'MPCORB.DAT.gz');

  const gotDistant = await download(
    'https://www.minorplanetcenter.net/iau/MPCORB/Distant.txt',
    distantPath,
    'MPC Distant.txt (TNOs, Centaurs)',
  );
  const gotMpcorb = await download(
    'https://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz',
    mpcorbPath,
    'MPC MPCORB.DAT.gz (main belt)',
  );
  if (!gotDistant && !gotMpcorb) {
    return null;
  }

  const all: SmallBody[] = [];

  if (gotDistant) {
    const text = await fs.readFile(distantPath, 'utf8');
    for (const line of text.split('\n')) {
      const b = parseMpcLine(line);
      if (b) {
        all.push(b);
      }
    }
    console.log(`  ${C.dim('parsed ')} ${all.length} distant objects`);
  }

  if (gotMpcorb) {
    const before = all.length;
    // ~315 MB decompressed, 1.5 M records: stream it and keep only the bright
    // end, which is all we render individually.
    const rl = createInterface({
      input: createReadStream(mpcorbPath).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const b = parseMpcLine(line);
      if (b && b.h <= 11.5) {
        all.push(b);
      }
    }
    console.log(`  ${C.dim('parsed ')} ${all.length - before} bright MPCORB objects`);
  }

  // Distant.txt and MPCORB overlap on the TNOs; keep the brighter entry.
  const byName = new Map<string, SmallBody>();
  for (const b of all) {
    const prev = byName.get(b.name);
    if (!prev || b.h < prev.h) {
      byName.set(b.name, b);
    }
  }

  return topPerGroup([...byName.values()], {
    'near-earth': 6,
    'inner-belt': 22,
    'mid-belt': 30,
    'outer-belt': 30,
    cybele: 10,
    hilda: 8,
    'jupiter-trojan': 24,
    centaur: 16,
    plutino: 22,
    'classical-kbo': 26,
    scattered: 22,
    detached: 10,
  });
}

export async function writeSmallBodyModule(bodies: SmallBody[]): Promise<void> {
  const byGroup = new Map<string, number>();
  for (const b of bodies) {
    byGroup.set(b.group, (byGroup.get(b.group) ?? 0) + 1);
  }
  const summary = [...byGroup.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(', ');

  const lines = bodies.map(
    (b) =>
      `  { name: ${JSON.stringify(b.name)}, h: ${r6(b.h)}, a: ${r6(b.a)}, e: ${r6(b.e)}, inc: ${r6(
        b.inc,
      )}, node: ${r6(b.node)}, argPeri: ${r6(b.argPeri)}, m0: ${r6(b.m0)}, epoch: ${r6(
        b.epoch,
      )}, group: ${JSON.stringify(b.group)} },`,
  );

  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Osculating orbital elements for the largest minor planets, from the IAU Minor
 * Planet Center orbit catalogues (MPCORB.DAT and Distant.txt).
 *
 * ${bodies.length} bodies: ${summary}.
 *
 * Selection is the brightest (hence largest) objects per dynamical family, so
 * every dwarf planet and every major belt / Trojan / Kuiper population is
 * present with its real orbit. The dense background swarms are generated
 * statistically at runtime -- see src/data/belts.ts.
 *
 * Angles are degrees, semi-major axis AU, epoch Julian Date.
 */

export interface SmallBodyData {
  name: string
  /** Absolute magnitude -- the size proxy used for the render radius. */
  h: number
  /** Semi-major axis, AU. */
  a: number
  e: number
  /** Inclination to the ecliptic, degrees. */
  inc: number
  /** Longitude of ascending node, degrees. */
  node: number
  /** Argument of perihelion, degrees. */
  argPeri: number
  /** Mean anomaly at epoch, degrees. */
  m0: number
  epoch: number
  group: string
}

export const SMALL_BODIES: readonly SmallBodyData[] = [
${lines.join('\n')}
]
`;
  await fs.mkdir(GENERATED, { recursive: true });
  await fs.writeFile(path.join(GENERATED, 'smallbodies.ts'), src);
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/smallbodies.ts ${C.dim(`(${bodies.length} bodies)`)}`,
  );
}
