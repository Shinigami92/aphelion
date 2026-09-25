/** Orbital elements from the JPL satellite and MPC small-body tables. */

import type { Elements } from '../../astro/kepler.ts';
import type { SatelliteData } from '../../data/generated/satellites.ts';
import type { SmallBodyData } from '../../data/generated/smallbodies.ts';
import { AU_KM, DEG, TWO_PI } from '../constants.ts';

export function elementsFromSatellite(sat: SatelliteData): Elements {
  const retrograde = sat.inc > 90;
  // JPL quotes the apsidal and nodal precession as periods in years. Prograde
  // satellites of an oblate primary have an advancing apsis and a regressing
  // node; retrograde satellites are the other way round.
  const apsisRate =
    sat.apsisPeriod !== null && sat.apsisPeriod !== 0 ? TWO_PI / (sat.apsisPeriod * 365.25) : 0;
  const nodeRate =
    sat.nodePeriod !== null && sat.nodePeriod !== 0 ? TWO_PI / (sat.nodePeriod * 365.25) : 0;

  return {
    a: sat.a,
    e: sat.e,
    i: sat.inc * DEG,
    node: sat.node * DEG,
    argPeri: sat.argPeri * DEG,
    m0: sat.m0 * DEG,
    epoch: sat.epoch,
    n: TWO_PI / sat.period,
    argPeriDot: retrograde ? -apsisRate : apsisRate,
    nodeDot: retrograde ? nodeRate : -nodeRate,
  };
}

/** Gaussian gravitational constant: n = k / a^1.5 rad/day, a in AU. */
const GAUSS_K = 0.01720209895;

export function elementsFromSmallBody(sb: SmallBodyData): Elements {
  return {
    a: sb.a * AU_KM,
    e: sb.e,
    i: sb.inc * DEG,
    node: sb.node * DEG,
    argPeri: sb.argPeri * DEG,
    m0: sb.m0 * DEG,
    epoch: sb.epoch,
    n: GAUSS_K / Math.pow(sb.a, 1.5),
  };
}
