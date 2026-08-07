/**
 * Planetary positions from JPL's "Keplerian Elements for Approximate Positions
 * of the Major Planets" (E. M. Standish, JPL Solar System Dynamics).
 *
 * Each planet gets six elements at J2000 plus linear rates per Julian century.
 * Quoted accuracy over 1800-2050 is on the order of arcminutes in ecliptic
 * longitude — far below anything visible at the zoom levels this app renders,
 * and it needs no data files at all, which is what keeps the whole thing
 * offline.
 *
 * Note the table gives the **Earth-Moon barycentre**, not the Earth. We correct
 * for that using the lunar theory in `moon.ts`.
 */

import { AU_KM, DEG, MOON_BARY_FRACTION } from '../core/constants.ts'
import { centuriesSinceJ2000 } from './timescales.ts'
import { positionFromAngles, type Elements, type Vec3 } from './kepler.ts'
import { moonGeocentric } from './moon.ts'

export type PlanetKey =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'

/**
 * [a (au), e, I (deg), L (deg), longPeri (deg), longNode (deg)]
 * followed by the same six as rates per Julian century.
 */
interface KeplerTableRow {
  a: number
  aDot: number
  e: number
  eDot: number
  inc: number
  incDot: number
  L: number
  LDot: number
  peri: number
  periDot: number
  node: number
  nodeDot: number
}

const TABLE: Record<PlanetKey, KeplerTableRow> = {
  mercury: {
    a: 0.38709927, aDot: 0.00000037,
    e: 0.20563593, eDot: 0.00001906,
    inc: 7.00497902, incDot: -0.00594749,
    L: 252.2503235, LDot: 149472.67411175,
    peri: 77.45779628, periDot: 0.16047689,
    node: 48.33076593, nodeDot: -0.12534081,
  },
  venus: {
    a: 0.72333566, aDot: 0.0000039,
    e: 0.00677672, eDot: -0.00004107,
    inc: 3.39467605, incDot: -0.0007889,
    L: 181.9790995, LDot: 58517.81538729,
    peri: 131.60246718, periDot: 0.00268329,
    node: 76.67984255, nodeDot: -0.27769418,
  },
  // Earth-Moon barycentre.
  earth: {
    a: 1.00000261, aDot: 0.00000562,
    e: 0.01671123, eDot: -0.00004392,
    inc: -0.00001531, incDot: -0.01294668,
    L: 100.46457166, LDot: 35999.37244981,
    peri: 102.93768193, periDot: 0.32327364,
    node: 0.0, nodeDot: 0.0,
  },
  mars: {
    a: 1.52371034, aDot: 0.00001847,
    e: 0.0933941, eDot: 0.00007882,
    inc: 1.84969142, incDot: -0.00813131,
    L: -4.55343205, LDot: 19140.30268499,
    peri: -23.94362959, periDot: 0.44441088,
    node: 49.55953891, nodeDot: -0.29257343,
  },
  jupiter: {
    a: 5.202887, aDot: -0.00011607,
    e: 0.04838624, eDot: -0.00013253,
    inc: 1.30439695, incDot: -0.00183714,
    L: 34.39644051, LDot: 3034.74612775,
    peri: 14.72847983, periDot: 0.21252668,
    node: 100.47390909, nodeDot: 0.20469106,
  },
  saturn: {
    a: 9.53667594, aDot: -0.0012506,
    e: 0.05386179, eDot: -0.00050991,
    inc: 2.48599187, incDot: 0.00193609,
    L: 49.95424423, LDot: 1222.49362201,
    peri: 92.59887831, periDot: -0.41897216,
    node: 113.66242448, nodeDot: -0.28867794,
  },
  uranus: {
    a: 19.18916464, aDot: -0.00196176,
    e: 0.04725744, eDot: -0.00004397,
    inc: 0.77263783, incDot: -0.00242939,
    L: 313.23810451, LDot: 428.48202785,
    peri: 170.9542763, periDot: 0.40805281,
    node: 74.01692503, nodeDot: 0.04240589,
  },
  neptune: {
    a: 30.06992276, aDot: 0.00026291,
    e: 0.00859048, eDot: 0.00005105,
    inc: 1.77004347, incDot: 0.00035372,
    L: -55.12002969, LDot: 218.45945325,
    peri: 44.96476227, periDot: -0.32241464,
    node: 131.78422574, nodeDot: -0.00508664,
  },
  pluto: {
    a: 39.48211675, aDot: -0.00031596,
    e: 0.2488273, eDot: 0.0000517,
    inc: 17.14001206, incDot: 0.00004818,
    L: 238.92903833, LDot: 145.20780515,
    peri: 224.06891629, periDot: -0.04062942,
    node: 110.30393684, nodeDot: -0.01183482,
  },
}

export const PLANET_KEYS: readonly PlanetKey[] = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
]

/** Osculating-ish elements for a planet at a given time, in radians and km. */
export interface PlanetElements {
  a: number
  e: number
  inc: number
  node: number
  argPeri: number
  meanAnomaly: number
}

export function planetElementsAt(key: PlanetKey, jdTT: number): PlanetElements {
  const row = TABLE[key]
  const T = centuriesSinceJ2000(jdTT)

  const a = row.a + row.aDot * T
  const e = row.e + row.eDot * T
  const inc = row.inc + row.incDot * T
  const L = row.L + row.LDot * T
  const peri = row.peri + row.periDot * T
  const node = row.node + row.nodeDot * T

  return {
    a: a * AU_KM,
    e,
    inc: inc * DEG,
    node: node * DEG,
    argPeri: (peri - node) * DEG,
    meanAnomaly: (L - peri) * DEG,
  }
}

/**
 * J2000 mean elements in the common shape consumed by the orbit renderers.
 * The mean-anomaly rate is the mean-longitude rate minus the perihelion rate.
 */
export function planetOrbitElements(key: PlanetKey): Elements {
  const row = TABLE[key]
  const perDay = DEG / 36_525
  return {
    a: row.a * AU_KM,
    e: row.e,
    i: row.inc * DEG,
    node: row.node * DEG,
    argPeri: (row.peri - row.node) * DEG,
    m0: (row.L - row.peri) * DEG,
    epoch: 2451545.0,
    n: (row.LDot - row.periDot) * perDay,
    argPeriDot: (row.periDot - row.nodeDot) * perDay,
    nodeDot: row.nodeDot * perDay,
  }
}

/**
 * Heliocentric ecliptic J2000 position in km.
 *
 * For `earth` this returns the true Earth centre, not the barycentre: we
 * subtract the Moon's contribution using the lunar theory.
 */
export function planetPosition(key: PlanetKey, jdTT: number, out: Vec3): Vec3 {
  const el = planetElementsAt(key, jdTT)
  positionFromAngles(el.a, el.e, el.inc, el.node, el.argPeri, el.meanAnomaly, out)

  if (key === 'earth') {
    // r_earth = r_EMB - (m_moon / (m_earth + m_moon)) * r_moon(geocentric)
    const m = moonGeocentric(jdTT, { x: 0, y: 0, z: 0 })
    out.x -= MOON_BARY_FRACTION * m.x
    out.y -= MOON_BARY_FRACTION * m.y
    out.z -= MOON_BARY_FRACTION * m.z
  }
  return out
}

/** Earth-Moon barycentre, needed when placing the Moon itself. */
export function earthMoonBarycentre(jdTT: number, out: Vec3): Vec3 {
  const el = planetElementsAt('earth', jdTT)
  return positionFromAngles(el.a, el.e, el.inc, el.node, el.argPeri, el.meanAnomaly, out)
}
