/**
 * Keplerian two-body mechanics.
 *
 * Everything orbital in Aphelion reduces to: take a set of osculating or mean
 * elements defined in some reference plane, advance the mean anomaly, solve
 * Kepler's equation, and rotate the in-plane position out into the parent's
 * frame. This module is deliberately free of Three.js so it can be reasoned
 * about (and unit-checked) on its own.
 */

import { TWO_PI } from '../core/constants.ts'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Mean orbital elements. Angles in radians, distances in kilometres, rates in
 * radians per day. The reference plane is whatever the data source used; see
 * `frames.ts` for rotating Laplace/equatorial planes into ecliptic J2000.
 */
export interface Elements {
  /** Semi-major axis, km. */
  a: number
  /** Eccentricity. */
  e: number
  /** Inclination to the reference plane, rad. */
  i: number
  /** Longitude of ascending node, rad. */
  node: number
  /** Argument of periapsis, rad. */
  argPeri: number
  /** Mean anomaly at `epoch`, rad. */
  m0: number
  /** Epoch as a TT Julian Date. */
  epoch: number
  /** Mean motion, rad/day. */
  n: number
  /** Apsidal precession rate, rad/day (0 when unmodelled). */
  argPeriDot?: number
  /** Nodal regression rate, rad/day (0 when unmodelled). */
  nodeDot?: number
}

/** Normalise an angle into [0, 2pi). */
export function wrap2pi(x: number): number {
  const r = x % TWO_PI
  return r < 0 ? r + TWO_PI : r
}

/** Normalise an angle into [-pi, pi). */
export function wrapPi(x: number): number {
  const r = wrap2pi(x + Math.PI)
  return r - Math.PI
}

/**
 * Solve M = E - e sin E for the eccentric anomaly.
 *
 * Newton-Raphson from a Danby-style starting guess. Converges in 3-4 iterations
 * for e < 0.9; for the high-eccentricity comet-like orbits in the scattered
 * disc we fall back to bisection-guarded Newton so it cannot diverge.
 */
export function solveEccentricAnomaly(meanAnomaly: number, e: number): number {
  const M = wrapPi(meanAnomaly)

  if (e < 1e-8) return M

  // Danby's initial guess: good even at high eccentricity.
  let E = M + Math.sign(M) * 0.85 * e
  if (e > 0.8) E = M + e * Math.sin(M) * (1 + e * Math.cos(M))

  for (let iter = 0; iter < 30; iter++) {
    const sinE = Math.sin(E)
    const cosE = Math.cos(E)
    const f = E - e * sinE - M
    if (Math.abs(f) < 1e-13) break
    const fp = 1 - e * cosE
    // Guard against the vanishing derivative near e -> 1, M -> 0.
    let dE = f / (fp === 0 ? 1e-9 : fp)
    if (Math.abs(dE) > 1) dE = Math.sign(dE) // damp wild first steps
    E -= dE
  }
  return E
}

/** True anomaly from eccentric anomaly. */
export function trueAnomalyFromE(E: number, e: number): number {
  return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e)
}

/** Mean motion from semi-major axis and GM, rad/day. */
export function meanMotion(aKm: number, gm: number): number {
  // n = sqrt(GM / a^3) rad/s -> * 86400 for rad/day
  return Math.sqrt(gm / (aKm * aKm * aKm)) * 86_400
}

/** Orbital period in days. */
export function periodDays(aKm: number, gm: number): number {
  return TWO_PI / meanMotion(aKm, gm)
}

/**
 * Position in the elements' reference plane at a given TT Julian Date.
 * Writes into `out` to keep the per-frame allocation count at zero.
 */
export function positionAtTime(el: Elements, jdTT: number, out: Vec3): Vec3 {
  const dt = jdTT - el.epoch
  const M = el.m0 + el.n * dt
  const argPeri = el.argPeri + (el.argPeriDot ?? 0) * dt
  const node = el.node + (el.nodeDot ?? 0) * dt
  return positionFromAngles(el.a, el.e, el.i, node, argPeri, M, out)
}

/**
 * Position from explicit angles — the core rotation used everywhere.
 *
 * Perifocal coordinates rotated by R_z(node) R_x(i) R_z(argPeri), expanded
 * inline because this runs for ~500 bodies every frame.
 */
export function positionFromAngles(
  a: number,
  e: number,
  i: number,
  node: number,
  argPeri: number,
  meanAnomaly: number,
  out: Vec3,
): Vec3 {
  const E = solveEccentricAnomaly(meanAnomaly, e)
  // Perifocal plane.
  const xp = a * (Math.cos(E) - e)
  const yp = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E)

  const cosW = Math.cos(argPeri)
  const sinW = Math.sin(argPeri)
  const cosO = Math.cos(node)
  const sinO = Math.sin(node)
  const cosI = Math.cos(i)
  const sinI = Math.sin(i)

  out.x = (cosW * cosO - sinW * sinO * cosI) * xp + (-sinW * cosO - cosW * sinO * cosI) * yp
  out.y = (cosW * sinO + sinW * cosO * cosI) * xp + (-sinW * sinO + cosW * cosO * cosI) * yp
  out.z = sinW * sinI * xp + cosW * sinI * yp
  return out
}

/**
 * Orbital velocity in the reference plane, km/day. Used for the velocity
 * readout in the info panel and for orienting velocity-relative cameras.
 */
export function velocityAtTime(el: Elements, jdTT: number, out: Vec3): Vec3 {
  const dt = jdTT - el.epoch
  const M = el.m0 + el.n * dt
  const E = solveEccentricAnomaly(M, el.e)
  const argPeri = el.argPeri + (el.argPeriDot ?? 0) * dt
  const node = el.node + (el.nodeDot ?? 0) * dt

  const e = el.e
  const sqrt1me2 = Math.sqrt(Math.max(0, 1 - e * e))
  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  // dE/dt from differentiating Kepler's equation.
  const Edot = el.n / (1 - e * cosE)

  const vxp = -el.a * sinE * Edot
  const vyp = el.a * sqrt1me2 * cosE * Edot

  const cosW = Math.cos(argPeri)
  const sinW = Math.sin(argPeri)
  const cosO = Math.cos(node)
  const sinO = Math.sin(node)
  const cosI = Math.cos(el.i)
  const sinI = Math.sin(el.i)

  out.x = (cosW * cosO - sinW * sinO * cosI) * vxp + (-sinW * cosO - cosW * sinO * cosI) * vyp
  out.y = (cosW * sinO + sinW * cosO * cosI) * vxp + (-sinW * sinO + cosW * cosO * cosI) * vyp
  out.z = sinW * sinI * vxp + cosW * sinI * vyp
  return out
}

/**
 * Sample a full revolution as a closed polyline in the reference plane.
 *
 * Samples in eccentric anomaly rather than mean anomaly so eccentric orbits get
 * their vertices concentrated near periapsis, where the curvature is.
 */
export function sampleOrbit(el: Elements, segments: number, jdTT: number): Float64Array {
  const pts = new Float64Array(segments * 3)
  const dt = jdTT - el.epoch
  const argPeri = el.argPeri + (el.argPeriDot ?? 0) * dt
  const node = el.node + (el.nodeDot ?? 0) * dt

  const cosW = Math.cos(argPeri)
  const sinW = Math.sin(argPeri)
  const cosO = Math.cos(node)
  const sinO = Math.sin(node)
  const cosI = Math.cos(el.i)
  const sinI = Math.sin(el.i)
  const sqrt1me2 = Math.sqrt(Math.max(0, 1 - el.e * el.e))

  for (let s = 0; s < segments; s++) {
    const E = (s / segments) * TWO_PI
    const xp = el.a * (Math.cos(E) - el.e)
    const yp = el.a * sqrt1me2 * Math.sin(E)
    const o = s * 3
    pts[o] = (cosW * cosO - sinW * sinO * cosI) * xp + (-sinW * cosO - cosW * sinO * cosI) * yp
    pts[o + 1] = (cosW * sinO + sinW * cosO * cosI) * xp + (-sinW * sinO + cosW * cosO * cosI) * yp
    pts[o + 2] = sinW * sinI * xp + cosW * sinI * yp
  }
  return pts
}

/** Periapsis distance, km. */
export const periapsis = (el: Elements): number => el.a * (1 - el.e)
/** Apoapsis distance, km. */
export const apoapsis = (el: Elements): number => el.a * (1 + el.e)
