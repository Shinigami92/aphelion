/**
 * Statistical generation of the small-body populations.
 *
 * The 221 catalogued minor planets in `generated/smallbodies.ts` are the real,
 * individually named objects. This module generates the *background* — tens of
 * thousands of particles drawn from the actual distributions of semi-major axis,
 * eccentricity and inclination, so that the structure you can see is real
 * structure:
 *
 *   - Kirkwood gaps carved at the 4:1, 3:1, 5:2, 7:3 and 2:1 Jupiter resonances
 *   - Density peaks at the Flora/Vesta and Koronis/Themis family distances
 *   - Two Trojan camps librating around Jupiter's L4 and L5 points
 *   - The Hilda group out at the 3:2 resonance
 *   - A Kuiper belt with a cold, low-inclination classical core, a hot
 *     high-inclination component, the plutinos at 3:2 with Neptune, and a
 *     scattered disc reaching past 200 AU
 *
 * Everything is emitted as flat typed arrays of orbital elements; the particles
 * are then propagated on the GPU (see render/swarms.ts), which is what makes
 * ~70,000 independently orbiting bodies affordable.
 *
 * The populations themselves are in belts/, split by the planet that shapes them.
 */

import type { Writer } from './belts/sampling.ts';
import { JUPITER_FAMILY } from './belts/jupiter-family.ts';
import { KUIPER_BELT } from './belts/kuiper.ts';
import { meanMotion, mulberry32 } from './belts/sampling.ts';

export interface SwarmGroup {
  name: string;
  /** Base colour, linear RGB. */
  color: [number, number, number];
  /** Point size multiplier. */
  sizeScale: number;
  count: number;
  /** Offset into the shared arrays. */
  offset: number;
}

export interface SwarmData {
  /** Semi-major axis, AU. */
  a: Float32Array;
  e: Float32Array;
  /** Inclination, radians. */
  inc: Float32Array;
  /** Longitude of ascending node, radians. */
  node: Float32Array;
  /** Argument of perihelion, radians. */
  argPeri: Float32Array;
  /** Mean anomaly at J2000, radians. */
  m0: Float32Array;
  /** Mean motion, radians per day. */
  n: Float32Array;
  /** Per-particle brightness/size jitter. */
  size: Float32Array;
  /** Per-particle colour, 3 floats each. */
  color: Float32Array;
  groups: SwarmGroup[];
  total: number;
}

/** Every population, inner to outer. The order fixes which particles land where in the buffers. */
const POPULATIONS = [...JUPITER_FAMILY, ...KUIPER_BELT];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

let cached: SwarmData | null = null;

/** Build (once) the full background swarm dataset. */
export function buildSwarms(seed = 0x5eed1234): SwarmData {
  if (cached) {
    return cached;
  }

  const total = POPULATIONS.reduce((sum, p) => sum + p.count, 0);
  const data = allocateSwarms(total);
  const writer = swarmWriter(data);

  // One RNG stream per population so tweaking one leaves the others identical.
  let streamSeed = seed;
  for (const pop of POPULATIONS) {
    const offset = writer.written;
    pop.generate(
      mulberry32((streamSeed = (streamSeed * 1664525 + 1013904223) >>> 0)),
      writer,
      pop.color,
    );

    // Apply the population's size multiplier over the range it just wrote. The
    // outer populations need it: the Kuiper belt spreads a tenth as many bodies
    // over a hundred times the area, so at equal point size it all but vanishes
    // next to the main belt.
    if (pop.sizeScale !== 1) {
      for (let k = offset; k < writer.written; k++) {
        data.size[k] = data.size[k] * pop.sizeScale;
      }
    }

    data.groups.push({
      name: pop.name,
      color: pop.color,
      sizeScale: pop.sizeScale,
      count: writer.written - offset,
      offset,
    });
  }

  cached = data;
  return data;
}

function allocateSwarms(total: number): SwarmData {
  return {
    a: new Float32Array(total),
    e: new Float32Array(total),
    inc: new Float32Array(total),
    node: new Float32Array(total),
    argPeri: new Float32Array(total),
    m0: new Float32Array(total),
    n: new Float32Array(total),
    size: new Float32Array(total),
    color: new Float32Array(total * 3),
    groups: [],
    total,
  };
}

/** Fills `data` front to back, and says how many particles it has written so far. */
function swarmWriter(data: SwarmData): Writer & { readonly written: number } {
  let i = 0;
  return {
    get written() {
      return i;
    },
    push: (a, e, inc, node, argPeri, m0, size, r, g, b) => {
      if (i >= data.total) {
        return;
      }
      data.a[i] = a;
      data.e[i] = e;
      data.inc[i] = inc;
      data.node[i] = node;
      data.argPeri[i] = argPeri;
      data.m0[i] = m0;
      data.n[i] = meanMotion(a);
      data.size[i] = size;
      data.color[i * 3] = r;
      data.color[i * 3 + 1] = g;
      data.color[i * 3 + 2] = b;
      i++;
    },
  };
}

/** Summary for the UI: what the belts are made of. */
export function swarmSummary(): Array<{ name: string; count: number }> {
  return buildSwarms().groups.map((g) => ({ name: g.name, count: g.count }));
}
