/** Orbital elements from the JPL satellite and MPC small-body tables. */

import type { Elements } from '../../astro/kepler.ts';
import type { SatelliteData } from '../../data/generated/satellites.ts';
import type { SmallBodyData } from '../../data/generated/smallbodies.ts';
import { AU_KM, DEG, TWO_PI } from '../constants.ts';

export function elementsFromSatellite(sat: SatelliteData): Elements {
  const retrograde = sat.inc > 90;
  // JPL quotes the apsidal and nodal precession as unsigned periods in years, so
  // the direction comes from the physics. Whether the torque is the primary's
  // oblateness or the Sun's pull, the node precesses as -cos i and the apsis as
  // 5cos²i - 1. The node therefore regresses on a prograde orbit and advances on
  // a retrograde one, but the apsis advances on both: cos²i does not care which
  // way round the moon goes. Precessing retrograde apsides backwards put the
  // irregular moons' apse lines 76–141° off Horizons within a decade.
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
    argPeriDot: apsisRate,
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
