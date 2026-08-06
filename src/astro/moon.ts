/**
 * Lunar theory — Meeus, "Astronomical Algorithms" ch. 47 (an abridgement of
 * ELP-2000/82).
 *
 * The Moon is the one satellite that genuinely needs better than mean-element
 * treatment: it is close enough that a few tenths of a degree of error is
 * obvious, it drives the Earth/barycentre correction, and it is what makes
 * solar eclipses land on the right places at the right times. This
 * implementation carries the full 60-term longitude/radius table and 60-term
 * latitude table plus the planetary additive terms, giving roughly 10 arcsecond
 * accuracy in longitude and a few km in distance.
 */

import { DEG } from '../core/constants.ts'
import { centuriesSinceJ2000 } from './timescales.ts'
import type { Vec3 } from './kepler.ts'

/**
 * Periodic terms for longitude and radius (Meeus table 47.A).
 * Layout per row: D, M, M', F, sigma-l (1e-6 deg), sigma-r (1e-3 km).
 */
const TERMS_LR = new Int32Array([
  0, 0, 1, 0, 6288774, -20905355,
  2, 0, -1, 0, 1274027, -3699111,
  2, 0, 0, 0, 658314, -2955968,
  0, 0, 2, 0, 213618, -569925,
  0, 1, 0, 0, -185116, 48888,
  0, 0, 0, 2, -114332, -3149,
  2, 0, -2, 0, 58793, 246158,
  2, -1, -1, 0, 57066, -152138,
  2, 0, 1, 0, 53322, -170733,
  2, -1, 0, 0, 45758, -204586,
  0, 1, -1, 0, -40923, -129620,
  1, 0, 0, 0, -34720, 108743,
  0, 1, 1, 0, -30383, 104755,
  2, 0, 0, -2, 15327, 10321,
  0, 0, 1, 2, -12528, 0,
  0, 0, 1, -2, 10980, 79661,
  4, 0, -1, 0, 10675, -34782,
  0, 0, 3, 0, 10034, -23210,
  4, 0, -2, 0, 8548, -21636,
  2, 1, -1, 0, -7888, 24208,
  2, 1, 0, 0, -6766, 30824,
  1, 0, -1, 0, -5163, -8379,
  1, 1, 0, 0, 4987, -16675,
  2, -1, 1, 0, 4036, -12831,
  2, 0, 2, 0, 3994, -10445,
  4, 0, 0, 0, 3861, -11650,
  2, 0, -3, 0, 3665, 14403,
  0, 1, -2, 0, -2689, -7003,
  2, 0, -1, 2, -2602, 0,
  2, -1, -2, 0, 2390, 10056,
  1, 0, 1, 0, -2348, 6322,
  2, -2, 0, 0, 2236, -9884,
  0, 1, 2, 0, -2120, 5751,
  0, 2, 0, 0, -2069, 0,
  2, -2, -1, 0, 2048, -4950,
  2, 0, 1, -2, -1773, 4130,
  2, 0, 0, 2, -1595, 0,
  4, -1, -1, 0, 1215, -3958,
  0, 0, 2, 2, -1110, 0,
  3, 0, -1, 0, -892, 3258,
  2, 1, 1, 0, -810, 2616,
  4, -1, -2, 0, 759, -1897,
  0, 2, -1, 0, -713, -2117,
  2, 2, -1, 0, -700, 2354,
  2, 1, -2, 0, 691, 0,
  2, -1, 0, -2, 596, 0,
  4, 0, 1, 0, 549, -1423,
  0, 0, 4, 0, 537, -1117,
  4, -1, 0, 0, 520, -1571,
  1, 0, -2, 0, -487, -1739,
  2, 1, 0, -2, -399, 0,
  0, 0, 2, -2, -381, -4421,
  1, 1, 1, 0, 351, 0,
  3, 0, -2, 0, -340, 0,
  4, 0, -3, 0, 330, 0,
  2, -1, 2, 0, 327, 0,
  0, 2, 1, 0, -323, 1165,
  1, 1, -1, 0, 299, 0,
  2, 0, 3, 0, 294, 0,
  2, 0, -1, -2, 0, 8752,
])

/**
 * Periodic terms for latitude (Meeus table 47.B).
 * Layout per row: D, M, M', F, sigma-b (1e-6 deg).
 */
const TERMS_B = new Int32Array([
  0, 0, 0, 1, 5128122,
  0, 0, 1, 1, 280602,
  0, 0, 1, -1, 277693,
  2, 0, 0, -1, 173237,
  2, 0, -1, 1, 55413,
  2, 0, -1, -1, 46271,
  2, 0, 0, 1, 32573,
  0, 0, 2, 1, 17198,
  2, 0, 1, -1, 9266,
  0, 0, 2, -1, 8822,
  2, -1, 0, -1, 8216,
  2, 0, -2, -1, 4324,
  2, 0, 1, 1, 4200,
  2, 1, 0, -1, -3359,
  2, -1, -1, 1, 2463,
  2, -1, 0, 1, 2211,
  2, -1, -1, -1, 2065,
  0, 1, -1, -1, -1870,
  4, 0, -1, -1, 1828,
  0, 1, 0, 1, -1794,
  0, 0, 0, 3, -1749,
  0, 1, -1, 1, -1565,
  1, 0, 0, 1, -1491,
  0, 1, 1, 1, -1475,
  0, 1, 1, -1, -1410,
  0, 1, 0, -1, -1344,
  1, 0, 0, -1, -1335,
  0, 0, 3, 1, 1107,
  4, 0, 0, -1, 1021,
  4, 0, -1, 1, 833,
  0, 0, 1, -3, 777,
  4, 0, -2, 1, 671,
  2, 0, 0, -3, 607,
  2, 0, 2, -1, 596,
  2, -1, 1, -1, 491,
  2, 0, -2, 1, -451,
  0, 0, 3, -1, 439,
  2, 0, 2, 1, 422,
  2, 0, -3, -1, 421,
  2, 1, -1, 1, -366,
  2, 1, 0, 1, -351,
  4, 0, 0, 1, 331,
  2, -1, 1, 1, 315,
  2, -2, 0, -1, 302,
  0, 0, 1, 3, -283,
  2, 1, 1, -1, -229,
  1, 1, 0, -1, 223,
  1, 1, 0, 1, 223,
  0, 1, -2, -1, -220,
  2, 1, -1, -1, -220,
  1, 0, 1, 1, -185,
  2, -1, -2, -1, 181,
  0, 1, 2, 1, -177,
  4, 0, -2, -1, 176,
  4, -1, -1, -1, 166,
  1, 0, 1, -1, -164,
  4, 0, 1, -1, 132,
  1, 0, -1, -1, -119,
  4, -1, 0, -1, 115,
  2, -2, 0, 1, 107,
])

/** General precession in ecliptic longitude, degrees per Julian century. */
const PRECESSION_DEG_PER_CENTURY = 5029.0966 / 3600

export interface LunarState {
  /** Apparent geocentric ecliptic longitude, radians (referred to J2000). */
  longitude: number
  /** Geocentric ecliptic latitude, radians. */
  latitude: number
  /** Geocentric distance, km. */
  distance: number
}

/** Geocentric ecliptic spherical coordinates of the Moon. */
export function moonSpherical(jdTT: number): LunarState {
  const T = centuriesSinceJ2000(jdTT)
  const T2 = T * T
  const T3 = T2 * T
  const T4 = T3 * T

  // Mean arguments, degrees.
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000

  // Eccentricity of Earth's orbit around the Sun, used to damp solar terms.
  const E = 1 - 0.002516 * T - 0.0000074 * T2

  const Dr = D * DEG
  const Mr = M * DEG
  const Mpr = Mp * DEG
  const Fr = F * DEG

  let sumL = 0
  let sumR = 0
  for (let k = 0; k < TERMS_LR.length; k += 6) {
    const cM = TERMS_LR[k + 1]!
    const arg = TERMS_LR[k]! * Dr + cM * Mr + TERMS_LR[k + 2]! * Mpr + TERMS_LR[k + 3]! * Fr
    // Terms containing M are damped by E (once per power of M).
    const ecc = cM === 0 ? 1 : cM === 1 || cM === -1 ? E : E * E
    sumL += TERMS_LR[k + 4]! * ecc * Math.sin(arg)
    sumR += TERMS_LR[k + 5]! * ecc * Math.cos(arg)
  }

  let sumB = 0
  for (let k = 0; k < TERMS_B.length; k += 5) {
    const cM = TERMS_B[k + 1]!
    const arg = TERMS_B[k]! * Dr + cM * Mr + TERMS_B[k + 2]! * Mpr + TERMS_B[k + 3]! * Fr
    const ecc = cM === 0 ? 1 : cM === 1 || cM === -1 ? E : E * E
    sumB += TERMS_B[k + 4]! * ecc * Math.sin(arg)
  }

  // Additive terms from Venus (A1), Jupiter (A2) and Earth's flattening (A3).
  const A1 = (119.75 + 131.849 * T) * DEG
  const A2 = (53.09 + 479264.29 * T) * DEG
  const A3 = (313.45 + 481266.484 * T) * DEG
  const Lpr = Lp * DEG

  sumL += 3958 * Math.sin(A1) + 1962 * Math.sin(Lpr - Fr) + 318 * Math.sin(A2)
  sumB +=
    -2235 * Math.sin(Lpr) +
    382 * Math.sin(A3) +
    175 * Math.sin(A1 - Fr) +
    175 * Math.sin(A1 + Fr) +
    127 * Math.sin(Lpr - Mpr) -
    115 * Math.sin(Lpr + Mpr)

  // Meeus returns coordinates of the mean equinox of date; rotate back to the
  // J2000 equinox so the Moon shares the frame with everything else.
  const lonOfDate = Lp + sumL / 1e6
  const longitude = (lonOfDate - PRECESSION_DEG_PER_CENTURY * T) * DEG
  const latitude = (sumB / 1e6) * DEG
  const distance = 385000.56 + sumR / 1000

  return { longitude, latitude, distance }
}

/** Geocentric ecliptic J2000 rectangular position of the Moon, km. */
export function moonGeocentric(jdTT: number, out: Vec3): Vec3 {
  const { longitude, latitude, distance } = moonSpherical(jdTT)
  const cosB = Math.cos(latitude)
  out.x = distance * cosB * Math.cos(longitude)
  out.y = distance * cosB * Math.sin(longitude)
  out.z = distance * Math.sin(latitude)
  return out
}

/**
 * Finite-difference geocentric velocity, km/day. Used to derive the Moon's
 * tidally locked orientation (its pole comes out of the orbit normal).
 */
export function moonGeocentricVelocity(jdTT: number, out: Vec3): Vec3 {
  const h = 0.02 // ~30 minutes
  const a = moonGeocentric(jdTT - h, { x: 0, y: 0, z: 0 })
  const b = moonGeocentric(jdTT + h, { x: 0, y: 0, z: 0 })
  out.x = (b.x - a.x) / (2 * h)
  out.y = (b.y - a.y) / (2 * h)
  out.z = (b.z - a.z) / (2 * h)
  return out
}
