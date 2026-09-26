/**
 * The populations Jupiter shapes: the main belt with its Kirkwood gaps, the
 * Hildas at the 3:2 resonance, and the two Trojan camps.
 */

import type { PopulationSpec, Writer } from './sampling.ts';
import { DEG } from '../../core/constants.ts';
import { gaussian, jitterColor, rayleigh, TWO_PI } from './sampling.ts';

// Jupiter's mean longitude and mean motion at J2000, needed to anchor the
// Trojan camps and the resonant families to the planet that shepherds them.
const JUPITER_L0 = 34.39644051;
const JUPITER_A = 5.202887;

/** A resonance gap: multiplicative notch in the density profile. */
function notch(a: number, center: number, width: number, depth: number): number {
  const d = (a - center) / width;
  return 1 - depth * Math.exp(-0.5 * d * d);
}

function bump(a: number, center: number, width: number, height: number): number {
  const d = (a - center) / width;
  return 1 + height * Math.exp(-0.5 * d * d);
}

/**
 * Relative number density of main-belt asteroids as a function of semi-major
 * axis. Broad hump with the real Kirkwood gaps cut into it.
 */
function mainBeltDensity(a: number): number {
  if (a < 2.05 || a > 3.32) {
    return 0;
  }
  let d = Math.exp(-Math.pow(a - 2.72, 2) / (2 * 0.42 * 0.42));
  // Kirkwood gaps (Jupiter mean-motion resonances).
  d *= notch(a, 2.065, 0.016, 0.9); // 4:1
  d *= notch(a, 2.502, 0.028, 0.93); // 3:1
  d *= notch(a, 2.825, 0.022, 0.88); // 5:2
  d *= notch(a, 2.958, 0.014, 0.72); // 7:3
  d *= notch(a, 3.279, 0.024, 0.9); // 2:1
  // Family concentrations: Flora/Vesta inner, Koronis/Eos/Themis outer.
  d *= bump(a, 2.35, 0.07, 0.75);
  d *= bump(a, 3.13, 0.09, 0.6);
  return d;
}

/** Rejection-sample the density profile. */
function sampleMainBeltAxis(rng: () => number): number {
  for (let attempt = 0; attempt < 64; attempt++) {
    const a = 2.05 + rng() * (3.32 - 2.05);
    if (rng() < mainBeltDensity(a)) {
      return a;
    }
  }
  return 2.7;
}

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
    const a = gaussian(rng, JUPITER_A, 0.055);
    const e = Math.min(0.25, rayleigh(rng, 0.05));
    const inc = Math.min(42 * DEG, rayleigh(rng, 10.5 * DEG));
    const node = rng() * TWO_PI;
    const argPeri = rng() * TWO_PI;

    // Tangential libration: the clouds are elongated along the orbit.
    const libration = gaussian(rng, 0, 13);
    const meanLongitude = (JUPITER_L0 + lagrangeOffsetDeg + libration) * DEG;
    // M = L - (node + argPeri)
    const m0 = meanLongitude - (node + argPeri);

    const [r, g, b] = jitterColor(rng, color, 0.4);
    w.push(a, e, inc, node, argPeri, m0, 0.7 + rng() * 0.8, r, g, b);
  }
}

export const JUPITER_FAMILY: PopulationSpec[] = [
  {
    name: 'Main belt',
    count: 42_000,
    color: [0.62, 0.56, 0.47],
    sizeScale: 1,
    generate: (rng, w, color) => {
      for (let k = 0; k < 42_000; k++) {
        const a = sampleMainBeltAxis(rng);
        const e = Math.min(0.35, rayleigh(rng, 0.1));
        const inc = Math.min(35 * DEG, rayleigh(rng, 8.2 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.45);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.6 + rng() * 0.8,
          r,
          g,
          b,
        );
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
      const aRes = JUPITER_A * Math.pow(2 / 3, 2 / 3);
      for (let k = 0; k < 1_600; k++) {
        const a = gaussian(rng, aRes, 0.045);
        const e = Math.min(0.34, Math.abs(gaussian(rng, 0.16, 0.06)));
        const inc = Math.min(20 * DEG, rayleigh(rng, 5 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.4);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.7 + rng() * 0.7,
          r,
          g,
          b,
        );
      }
    },
  },
  {
    name: 'Jupiter Trojans (L4 — Greeks)',
    count: 4_200,
    color: [0.55, 0.44, 0.36],
    sizeScale: 1.15,
    generate: (rng, w, color) => {
      generateTrojans(rng, w, color, 4_200, 60);
    },
  },
  {
    name: 'Jupiter Trojans (L5 — Trojans)',
    count: 3_400,
    color: [0.55, 0.44, 0.36],
    sizeScale: 1.15,
    generate: (rng, w, color) => {
      generateTrojans(rng, w, color, 3_400, -60);
    },
  },
];
