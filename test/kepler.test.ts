/**
 * Keplerian two-body mechanics.
 *
 * The checks worth having here are the ones that catch a plausible-looking but
 * wrong solar system: a diverged eccentric-anomaly solver, a transcription slip
 * in the inline rotation matrix, a missed unit factor in the mean motion.
 */

import { describe, it, expect } from 'vitest'
import {
  apoapsis,
  periapsis,
  periodDays,
  positionAtTime,
  positionFromAngles,
  sampleOrbit,
  solveEccentricAnomaly,
  trueAnomalyFromE,
  velocityAtTime,
  wrap2pi,
  wrapPi,
  type Elements,
  type Vec3,
} from '../src/astro/kepler.ts'
import { AU_KM, GM, J2000, TWO_PI } from '../src/core/constants.ts'

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 })

const EARTH_SEMI_MAJOR_AXIS_KM = 149_598_023
const EARTH_SIDEREAL_YEAR_DAYS = 365.256
const JULIAN_YEAR_DAYS = 365.25

/** A flat, mildly eccentric year-long orbit — Earth-like, for the time-domain checks. */
const yearOrbit = (eccentricity: number): Elements => ({
  a: AU_KM,
  e: eccentricity,
  i: 0,
  node: 0,
  argPeri: 0,
  m0: 0,
  epoch: J2000,
  n: TWO_PI / JULIAN_YEAR_DAYS,
})

/** An inclined, eccentric orbit with every angle non-zero, for the geometry checks. */
const tiltedOrbit: Elements = {
  a: 100, e: 0.4, i: 0.5, node: 1, argPeri: 2, m0: 0, epoch: J2000, n: 0.01,
}

/** Assert `E − e·sin E = M` holds for a full sweep of mean anomaly at one eccentricity. */
const solverResidualStaysSmall = (e: number): void => {
  const samples = 64
  for (let k = 0; k < samples; k++) {
    const M = -Math.PI + (k / samples) * TWO_PI
    const E = solveEccentricAnomaly(M, e)
    const residual = E - e * Math.sin(E) - wrapPi(M)
    expect(Math.abs(residual), `residual at M=${M.toFixed(3)}`).toBeLessThan(1e-9)
  }
}

describe('wrap2pi', () => {
  it('lands every input in [0, 2pi) a whole number of turns from where it started', () => {
    for (let x = -20; x <= 20; x += 0.013) {
      const w = wrap2pi(x)
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThan(TWO_PI)
      const turns = (x - w) / TWO_PI
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9)
    }
  })
})

describe('solveEccentricAnomaly', () => {
  it('is the identity below the small-eccentricity cutoff', () => {
    expect(solveEccentricAnomaly(0.3, 0)).toBeCloseTo(0.3, 12)
    expect(solveEccentricAnomaly(-1, 1e-10)).toBeCloseTo(-1, 12)
  })

  it('satisfies Kepler’s equation on a near-circular orbit', () => {
    solverResidualStaysSmall(0.01)
  })

  it('satisfies Kepler’s equation at Mercury-like eccentricity', () => {
    solverResidualStaysSmall(0.2)
  })

  it('satisfies Kepler’s equation at comet-like eccentricity', () => {
    solverResidualStaysSmall(0.85)
  })

  it('satisfies Kepler’s equation approaching parabolic', () => {
    solverResidualStaysSmall(0.99)
  })

  it('stays finite and roughly solved at the degenerate point e→1, M→0', () => {
    const E = solveEccentricAnomaly(0, 0.999999)
    expect(Number.isFinite(E)).toBe(true)
    expect(Math.abs(E - 0.999999 * Math.sin(E))).toBeLessThan(1e-6)
  })
})

describe('trueAnomalyFromE', () => {
  it('runs ahead of the eccentric anomaly on the periapsis side', () => {
    expect(trueAnomalyFromE(1, 0.5)).toBeGreaterThan(1)
  })
})

describe('periodDays', () => {
  it('reproduces Earth’s sidereal year to a fraction of a day', () => {
    expect(periodDays(EARTH_SEMI_MAJOR_AXIS_KM, GM.sun)).toBeCloseTo(EARTH_SIDEREAL_YEAR_DAYS, 1)
  })
})

describe('positionFromAngles', () => {
  it('places periapsis at a(1 − e) along the node line for a flat, unrotated orbit', () => {
    const out = positionFromAngles(100, 0.2, 0, 0, 0, 0, vec())
    expect(out.x).toBeCloseTo(80, 9)
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(0, 9)
  })

  it('keeps a zero-inclination orbit in the reference plane at every phase', () => {
    const phases = 64
    for (let k = 0; k < phases; k++) {
      const meanAnomaly = (k / phases) * TWO_PI
      const out = positionFromAngles(100, 0.4, 0, 1.1, 0.7, meanAnomaly, vec())
      expect(Math.abs(out.z)).toBeLessThan(1e-9)
    }
  })

  it('lifts a circular orbit out of plane by a·sin(i) a quarter-turn past the node', () => {
    const inclination = 0.3
    const out = positionFromAngles(100, 0, inclination, 0, 0, Math.PI / 2, vec())
    expect(out.z).toBeCloseTo(100 * Math.sin(inclination), 6)
  })
})

describe('positionAtTime', () => {
  const orbit = yearOrbit(0.0167)

  it('returns to the same point after one period', () => {
    const start = positionAtTime(orbit, orbit.epoch, vec())
    const oneYearLater = positionAtTime(orbit, orbit.epoch + JULIAN_YEAR_DAYS, vec())
    expect(oneYearLater.x).toBeCloseTo(start.x, 3)
    expect(oneYearLater.y).toBeCloseTo(start.y, 3)
  })

  it('drifts the orbit when apsidal and nodal precession rates are supplied', () => {
    const precessing: Elements = { ...orbit, argPeriDot: 1e-4, nodeDot: -5e-5 }
    const thousandDaysOn = orbit.epoch + 1000
    const still = positionAtTime(orbit, thousandDaysOn, vec())
    const drifted = positionAtTime(precessing, thousandDaysOn, vec())
    expect(Math.hypot(drifted.x - still.x, drifted.y - still.y, drifted.z - still.z)).toBeGreaterThan(1)
  })
})

describe('velocityAtTime', () => {
  it('has a periapsis-to-apoapsis speed ratio of (1 + e)/(1 − e)', () => {
    const orbit = yearOrbit(0.5)
    const speedAt = (jd: number): number => {
      const v = velocityAtTime(orbit, jd, vec())
      return Math.hypot(v.x, v.y, v.z)
    }
    const ratio = speedAt(orbit.epoch) / speedAt(orbit.epoch + JULIAN_YEAR_DAYS / 2)
    expect(ratio).toBeCloseTo((1 + 0.5) / (1 - 0.5), 1)
  })
})

describe('sampleOrbit', () => {
  it('keeps every sampled point between periapsis and apoapsis', () => {
    const segments = 128
    const pts = sampleOrbit(tiltedOrbit, segments, J2000)
    for (let s = 0; s < segments; s++) {
      const r = Math.hypot(pts[s * 3]!, pts[s * 3 + 1]!, pts[s * 3 + 2]!)
      expect(r).toBeGreaterThanOrEqual(periapsis(tiltedOrbit) - 1e-6)
      expect(r).toBeLessThanOrEqual(apoapsis(tiltedOrbit) + 1e-6)
    }
  })
})
