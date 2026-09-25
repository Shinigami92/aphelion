/**
 * The populations Neptune shapes: the plutinos and twotinos in resonance, the
 * cold and hot classical belt, and the scattered disc.
 */

import type { PopulationSpec } from './sampling.ts';
import { DEG } from '../../core/constants.ts';
import { gaussian, jitterColor, rayleigh, TWO_PI } from './sampling.ts';

/** Neptune, for the plutinos. */
const NEPTUNE_A = 30.06992276;

export const KUIPER_BELT: PopulationSpec[] = [
  {
    name: 'Plutinos (3:2 with Neptune)',
    count: 4_000,
    color: [0.6, 0.5, 0.55],
    sizeScale: 1.25,
    generate: (rng, w, color) => {
      const aRes = NEPTUNE_A * Math.pow(3 / 2, 2 / 3);
      for (let k = 0; k < 4_000; k++) {
        const a = gaussian(rng, aRes, 0.55);
        const e = Math.min(0.34, Math.abs(gaussian(rng, 0.16, 0.07)));
        const inc = Math.min(35 * DEG, rayleigh(rng, 9 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.4);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.8 + rng() * 0.8,
          r,
          g,
          b,
        );
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
        const a = gaussian(rng, 44.2, 2.2);
        if (a < 39.5 || a > 48.2) {
          k--;
          continue;
        }
        const e = Math.min(0.2, rayleigh(rng, 0.05));
        const inc = Math.min(8 * DEG, rayleigh(rng, 1.8 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.35);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.85 + rng() * 0.9,
          r,
          g,
          b,
        );
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
        const a = gaussian(rng, 44.5, 2.6);
        if (a < 39.5 || a > 48.5) {
          k--;
          continue;
        }
        const e = Math.min(0.28, rayleigh(rng, 0.09));
        const inc = Math.min(40 * DEG, rayleigh(rng, 13 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.35);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.85 + rng() * 0.9,
          r,
          g,
          b,
        );
      }
    },
  },
  {
    name: 'Twotinos (2:1 with Neptune)',
    count: 900,
    color: [0.6, 0.55, 0.62],
    sizeScale: 1.3,
    generate: (rng, w, color) => {
      const aRes = NEPTUNE_A * Math.pow(2, 2 / 3);
      for (let k = 0; k < 900; k++) {
        const a = gaussian(rng, aRes, 0.5);
        const e = Math.min(0.35, Math.abs(gaussian(rng, 0.22, 0.07)));
        const inc = Math.min(25 * DEG, rayleigh(rng, 7 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.35);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.9 + rng() * 0.8,
          r,
          g,
          b,
        );
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
        const a = 48 + Math.pow(rng(), 2.4) * 210;
        // Perihelia stay clustered near Neptune, which is what scattered them.
        const q = gaussian(rng, 36, 6);
        const e = Math.max(0.05, Math.min(0.92, 1 - Math.max(5, q) / a));
        const inc = Math.min(45 * DEG, rayleigh(rng, 13 * DEG));
        const [r, g, b] = jitterColor(rng, color, 0.35);
        w.push(
          a,
          e,
          inc,
          rng() * TWO_PI,
          rng() * TWO_PI,
          rng() * TWO_PI,
          0.9 + rng() * 0.9,
          r,
          g,
          b,
        );
      }
    },
  },
];
