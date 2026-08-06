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
 */

import { DEG } from '../core/constants.ts'

/** Deterministic PRNG so the belt looks identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rayleigh-distributed sample — the standard fit for orbital e and i. */
function rayleigh(rng: () => number, sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(1 - rng() * 0.999999))
}

function gaussian(rng: () => number, mean: number, sigma: number): number {
  const u = Math.max(1e-9, rng())
  const v = rng()
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface SwarmGroup {
  name: string
  /** Base colour, linear RGB. */
  color: [number, number, number]
  /** Point size multiplier. */
  sizeScale: number
  count: number
  /** Offset into the shared arrays. */
  offset: number
}

export interface SwarmData {
  /** Semi-major axis, AU. */
  a: Float32Array
  e: Float32Array
  /** Inclination, radians. */
  inc: Float32Array
  /** Longitude of ascending node, radians. */
  node: Float32Array
  /** Argument of perihelion, radians. */
  argPeri: Float32Array
  /** Mean anomaly at J2000, radians. */
  m0: Float32Array
  /** Mean motion, radians per day. */
  n: Float32Array
  /** Per-particle brightness/size jitter. */
  size: Float32Array
  /** Per-particle colour, 3 floats each. */
  color: Float32Array
  groups: SwarmGroup[]
  total: number
}

// Jupiter's mean longitude and mean motion at J2000, needed to anchor the
// Trojan camps and the resonant families to the planet that shepherds them.
const JUPITER_L0 = 34.39644051
const JUPITER_A = 5.202887
/** Neptune, for the plutinos. */
const NEPTUNE_A = 30.06992276

/** Gaussian-mean-motion constant: n = k / a^1.5, radians/day for a in AU. */
const GAUSS_K = 0.01720209895

const meanMotion = (a: number): number => GAUSS_K / Math.pow(a, 1.5)

// ---------------------------------------------------------------------------
// Main asteroid belt
// ---------------------------------------------------------------------------

/** A resonance gap: multiplicative notch in the density profile. */
function notch(a: number, center: number, width: number, depth: number): number {
  const d = (a - center) / width
  return 1 - depth * Math.exp(-0.5 * d * d)
}

function bump(a: number, center: number, width: number, height: number): number {
  const d = (a - center) / width
  return 1 + height * Math.exp(-0.5 * d * d)
}

/**
 * Relative number density of main-belt asteroids as a function of semi-major
 * axis. Broad hump with the real Kirkwood gaps cut into it.
 */
function mainBeltDensity(a: number): number {
  if (a < 2.05 || a > 3.32) return 0
  let d = Math.exp(-Math.pow(a - 2.72, 2) / (2 * 0.42 * 0.42))
  // Kirkwood gaps (Jupiter mean-motion resonances).
  d *= notch(a, 2.065, 0.016, 0.9) // 4:1
  d *= notch(a, 2.502, 0.028, 0.93) // 3:1
  d *= notch(a, 2.825, 0.022, 0.88) // 5:2
  d *= notch(a, 2.958, 0.014, 0.72) // 7:3
  d *= notch(a, 3.279, 0.024, 0.9) // 2:1
  // Family concentrations: Flora/Vesta inner, Koronis/Eos/Themis outer.
  d *= bump(a, 2.35, 0.07, 0.75)
  d *= bump(a, 3.13, 0.09, 0.6)
  return d
}

/** Rejection-sample the density profile. */
function sampleMainBeltAxis(rng: () => number): number {
  for (let attempt = 0; attempt < 64; attempt++) {
    const a = 2.05 + rng() * (3.32 - 2.05)
    if (rng() < mainBeltDensity(a)) return a
  }
  return 2.7
}

// ---------------------------------------------------------------------------
// Population builders
// ---------------------------------------------------------------------------

interface Writer {
  push: (
    a: number,
    e: number,
    inc: number,
    node: number,
    argPeri: number,
    m0: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ) => void
}

interface PopulationSpec {
  name: string
  count: number
  color: [number, number, number]
  sizeScale: number
  generate: (rng: () => number, w: Writer, color: [number, number, number]) => void
}

const TWO_PI = Math.PI * 2

/** Slight per-particle colour jitter so the swarm never looks like flat paint. */
function jitterColor(
  rng: () => number,
  base: [number, number, number],
  amount: number,
): [number, number, number] {
  const k = 1 + (rng() - 0.5) * amount
  return [base[0] * k, base[1] * k, base[2] * k]
}

const POPULATIONS: PopulationSpec[] = [
  {
    name: 'Main belt',
    count: 42_000,
    color: [0.62, 0.56, 0.47],
    sizeScale: 1,
    generate: (rng, w, color) => {
      for (let k = 0; k < 42_000; k++) {
        const a = sampleMainBeltAxis(rng)
        const e = Math.min(0.35, rayleigh(rng, 0.1))
        const inc = Math.min(35 * DEG, rayleigh(rng, 8.2 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.45)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.6 + rng() * 0.8, r, g, b)
      }
    },
  },
  {
    name: 'Hilda group',
    count: 1_600,
    color: [0.68, 0.5, 0.38],
    sizeScale: 1.1,
    generate: (rng, w, color) => {
      // 3:2 resonance with Jupiter.
      const aRes = JUPITER_A * Math.pow(2 / 3, 2 / 3)
      for (let k = 0; k < 1_600; k++) {
        const a = gaussian(rng, aRes, 0.045)
        const e = Math.min(0.34, Math.abs(gaussian(rng, 0.16, 0.06)))
        const inc = Math.min(20 * DEG, rayleigh(rng, 5 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.4)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.7 + rng() * 0.7, r, g, b)
      }
    },
  },
  {
    name: 'Jupiter Trojans (L4 — Greeks)',
    count: 4_200,
    color: [0.55, 0.44, 0.36],
    sizeScale: 1.15,
    generate: (rng, w, color) => generateTrojans(rng, w, color, 4_200, +60),
  },
  {
    name: 'Jupiter Trojans (L5 — Trojans)',
    count: 3_400,
    color: [0.55, 0.44, 0.36],
    sizeScale: 1.15,
    generate: (rng, w, color) => generateTrojans(rng, w, color, 3_400, -60),
  },
  {
    name: 'Plutinos (3:2 with Neptune)',
    count: 4_000,
    color: [0.6, 0.5, 0.55],
    sizeScale: 1.25,
    generate: (rng, w, color) => {
      const aRes = NEPTUNE_A * Math.pow(3 / 2, 2 / 3)
      for (let k = 0; k < 4_000; k++) {
        const a = gaussian(rng, aRes, 0.55)
        const e = Math.min(0.34, Math.abs(gaussian(rng, 0.16, 0.07)))
        const inc = Math.min(35 * DEG, rayleigh(rng, 9 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.4)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.8 + rng() * 0.8, r, g, b)
      }
    },
  },
  {
    name: 'Classical Kuiper belt (cold)',
    count: 9_000,
    color: [0.58, 0.62, 0.72],
    sizeScale: 1.3,
    generate: (rng, w, color) => {
      for (let k = 0; k < 9_000; k++) {
        // The cold classicals are a dynamically pristine, thin disc.
        const a = gaussian(rng, 44.2, 2.2)
        if (a < 39.5 || a > 48.2) {
          k--
          continue
        }
        const e = Math.min(0.2, rayleigh(rng, 0.05))
        const inc = Math.min(8 * DEG, rayleigh(rng, 1.8 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.35)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.85 + rng() * 0.9, r, g, b)
      }
    },
  },
  {
    name: 'Classical Kuiper belt (hot)',
    count: 5_000,
    color: [0.66, 0.58, 0.6],
    sizeScale: 1.3,
    generate: (rng, w, color) => {
      for (let k = 0; k < 5_000; k++) {
        const a = gaussian(rng, 44.5, 2.6)
        if (a < 39.5 || a > 48.5) {
          k--
          continue
        }
        const e = Math.min(0.28, rayleigh(rng, 0.09))
        const inc = Math.min(40 * DEG, rayleigh(rng, 13 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.35)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.85 + rng() * 0.9, r, g, b)
      }
    },
  },
  {
    name: 'Twotinos (2:1 with Neptune)',
    count: 900,
    color: [0.6, 0.55, 0.62],
    sizeScale: 1.3,
    generate: (rng, w, color) => {
      const aRes = NEPTUNE_A * Math.pow(2, 2 / 3)
      for (let k = 0; k < 900; k++) {
        const a = gaussian(rng, aRes, 0.5)
        const e = Math.min(0.35, Math.abs(gaussian(rng, 0.22, 0.07)))
        const inc = Math.min(25 * DEG, rayleigh(rng, 7 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.35)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.9 + rng() * 0.8, r, g, b)
      }
    },
  },
  {
    name: 'Scattered disc',
    count: 4_500,
    color: [0.5, 0.52, 0.6],
    sizeScale: 1.35,
    generate: (rng, w, color) => {
      for (let k = 0; k < 4_500; k++) {
        // Steeply falling in a, reaching well past 100 AU.
        const a = 48 + Math.pow(rng(), 2.4) * 210
        // Perihelia stay clustered near Neptune, which is what scattered them.
        const q = gaussian(rng, 36, 6)
        const e = Math.max(0.05, Math.min(0.92, 1 - Math.max(5, q) / a))
        const inc = Math.min(45 * DEG, rayleigh(rng, 13 * DEG))
        const [r, g, b] = jitterColor(rng, color, 0.35)
        w.push(a, e, inc, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, 0.9 + rng() * 0.9, r, g, b)
      }
    },
  },
]

/**
 * Trojan camps.
 *
 * Anchored so each particle's mean longitude sits 60 degrees ahead of (L4) or
 * behind (L5) Jupiter, with a libration spread. Because their semi-major axes
 * match Jupiter's, their mean motions do too, so the camps travel with the
 * planet instead of smearing into a ring.
 */
function generateTrojans(
  rng: () => number,
  w: Writer,
  color: [number, number, number],
  count: number,
  lagrangeOffsetDeg: number,
): void {
  for (let k = 0; k < count; k++) {
    // Libration in semi-major axis and longitude are correlated in reality;
    // a modest independent spread reproduces the observed cloud shape well.
    const a = gaussian(rng, JUPITER_A, 0.055)
    const e = Math.min(0.25, rayleigh(rng, 0.05))
    const inc = Math.min(42 * DEG, rayleigh(rng, 10.5 * DEG))
    const node = rng() * TWO_PI
    const argPeri = rng() * TWO_PI

    // Tangential libration: the clouds are elongated along the orbit.
    const libration = gaussian(rng, 0, 13)
    const meanLongitude = (JUPITER_L0 + lagrangeOffsetDeg + libration) * DEG
    // M = L - (node + argPeri)
    const m0 = meanLongitude - (node + argPeri)

    const [r, g, b] = jitterColor(rng, color, 0.4)
    w.push(a, e, inc, node, argPeri, m0, 0.7 + rng() * 0.8, r, g, b)
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

let cached: SwarmData | null = null

/** Build (once) the full background swarm dataset. */
export function buildSwarms(seed = 0x5eed1234): SwarmData {
  if (cached) return cached

  const total = POPULATIONS.reduce((sum, p) => sum + p.count, 0)
  const data: SwarmData = {
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
  }

  let i = 0
  const writer: Writer = {
    push: (a, e, inc, node, argPeri, m0, size, r, g, b) => {
      if (i >= total) return
      data.a[i] = a
      data.e[i] = e
      data.inc[i] = inc
      data.node[i] = node
      data.argPeri[i] = argPeri
      data.m0[i] = m0
      data.n[i] = meanMotion(a)
      data.size[i] = size
      data.color[i * 3] = r
      data.color[i * 3 + 1] = g
      data.color[i * 3 + 2] = b
      i++
    },
  }

  // One RNG stream per population so tweaking one leaves the others identical.
  let streamSeed = seed
  for (const pop of POPULATIONS) {
    const offset = i
    pop.generate(mulberry32((streamSeed = (streamSeed * 1664525 + 1013904223) >>> 0)), writer, pop.color)

    // Apply the population's size multiplier over the range it just wrote. The
    // outer populations need it: the Kuiper belt spreads a tenth as many bodies
    // over a hundred times the area, so at equal point size it all but vanishes
    // next to the main belt.
    if (pop.sizeScale !== 1) {
      for (let k = offset; k < i; k++) data.size[k] = data.size[k]! * pop.sizeScale
    }

    data.groups.push({
      name: pop.name,
      color: pop.color,
      sizeScale: pop.sizeScale,
      count: i - offset,
      offset,
    })
  }

  cached = data
  return data
}

/** Summary for the UI: what the belts are made of. */
export function swarmSummary(): { name: string; count: number }[] {
  return buildSwarms().groups.map((g) => ({ name: g.name, count: g.count }))
}
