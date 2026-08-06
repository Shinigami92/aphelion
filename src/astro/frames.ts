/**
 * Reference frames and body orientation.
 *
 * Aphelion's canonical frame is **ecliptic J2000** (x toward the J2000 vernal
 * equinox, z toward the ecliptic north pole). Source data arrives in three
 * different frames, so everything funnels through here:
 *
 *   - ecliptic   — already canonical (JPL planetary elements, outer irregulars)
 *   - equatorial — ICRF/J2000 equator (Pluto system satellites)
 *   - Laplace    — a body-specific plane given by its pole RA/Dec (inner moons,
 *                  where the parent's oblateness dominates the precession)
 *
 * IAU body orientation lives here too, since it is the same pole-plus-meridian
 * construction as the Laplace basis.
 */

import { DEG, OBLIQUITY_J2000 } from '../core/constants.ts'
import type { Vec3 } from './kepler.ts'

const COS_EPS = Math.cos(OBLIQUITY_J2000)
const SIN_EPS = Math.sin(OBLIQUITY_J2000)

/** An orthonormal basis expressed in ecliptic J2000 coordinates. */
export interface Basis {
  x: Vec3
  y: Vec3
  z: Vec3
}

export type FrameKind = 'ecliptic' | 'equatorial' | 'laplace'

// ---------------------------------------------------------------------------
// Equatorial <-> ecliptic
// ---------------------------------------------------------------------------

/** Rotate an ICRF/equatorial J2000 vector into ecliptic J2000, in place. */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  const y = v.y * COS_EPS + v.z * SIN_EPS
  const z = -v.y * SIN_EPS + v.z * COS_EPS
  v.y = y
  v.z = z
  return v
}

/** Rotate an ecliptic J2000 vector into ICRF/equatorial J2000, in place. */
export function eclipticToEquatorial(v: Vec3): Vec3 {
  const y = v.y * COS_EPS - v.z * SIN_EPS
  const z = v.y * SIN_EPS + v.z * COS_EPS
  v.y = y
  v.z = z
  return v
}

/** Unit vector for an equatorial right ascension / declination pair (radians). */
export function raDecToVector(ra: number, dec: number): Vec3 {
  const cd = Math.cos(dec)
  return { x: cd * Math.cos(ra), y: cd * Math.sin(ra), z: Math.sin(dec) }
}

// ---------------------------------------------------------------------------
// Vector helpers (tiny, allocation-light)
// ---------------------------------------------------------------------------

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  v.x /= len
  v.y /= len
  v.z /= len
  return v
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export const IDENTITY_BASIS: Basis = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
}

/**
 * Build an orthonormal basis in ecliptic J2000 from a pole given in equatorial
 * RA/Dec (degrees).
 *
 * The in-plane x-axis points along the ascending node of the plane on the ICRF
 * equator — i.e. toward RA + 90 degrees — which is the convention JPL's
 * satellite element tables use for their Laplace-plane angles.
 */
export function basisFromPole(poleRaDeg: number, poleDecDeg: number): Basis {
  const ra = poleRaDeg * DEG
  const dec = poleDecDeg * DEG

  const z = raDecToVector(ra, dec)
  // Ascending node of the plane on the equator: zhat x pole, normalised.
  const x: Vec3 = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 }
  const y = cross(z, x)

  equatorialToEcliptic(z)
  equatorialToEcliptic(x)
  equatorialToEcliptic(y)

  return { x: normalize(x), y: normalize(y), z: normalize(z) }
}

/**
 * Resolve the basis for a satellite's reference plane.
 * `pole` is required for the Laplace frame and ignored otherwise.
 */
export function basisForFrame(
  kind: FrameKind,
  poleRaDeg: number | null,
  poleDecDeg: number | null,
): Basis {
  switch (kind) {
    case 'ecliptic':
      return IDENTITY_BASIS
    case 'equatorial':
      // The ICRF equator, expressed in ecliptic coordinates.
      return basisFromPole(0, 90)
    case 'laplace':
      if (poleRaDeg === null || poleDecDeg === null) return IDENTITY_BASIS
      return basisFromPole(poleRaDeg, poleDecDeg)
  }
}

/** Transform in-plane coordinates by a basis, writing ecliptic J2000 into out. */
export function applyBasis(basis: Basis, x: number, y: number, z: number, out: Vec3): Vec3 {
  out.x = basis.x.x * x + basis.y.x * y + basis.z.x * z
  out.y = basis.x.y * x + basis.y.y * y + basis.z.y * z
  out.z = basis.x.z * x + basis.y.z * y + basis.z.z * z
  return out
}

// ---------------------------------------------------------------------------
// IAU body orientation
// ---------------------------------------------------------------------------

/**
 * IAU rotation model: right ascension and declination of the north pole plus a
 * prime meridian angle W that advances linearly. Pole drift rates are per
 * Julian century; W in degrees per day.
 *
 * A negative `wDot` is a retrograde rotator (Venus, Uranus, Pluto).
 */
export interface SpinModel {
  poleRa: number
  poleRaDot?: number
  poleDec: number
  poleDecDot?: number
  w0: number
  wDot: number
}

/**
 * Orientation of a body's fixed frame at a given time, in ecliptic J2000.
 *
 * Returned as a basis whose z-axis is the rotation pole and whose x-axis points
 * at the prime meridian, so a mesh can be oriented by loading it straight into
 * a rotation matrix.
 */
export function spinBasis(spin: SpinModel, daysSinceJ2000: number, centuries: number): Basis {
  const ra = (spin.poleRa + (spin.poleRaDot ?? 0) * centuries) * DEG
  const dec = (spin.poleDec + (spin.poleDecDot ?? 0) * centuries) * DEG
  const w = (spin.w0 + spin.wDot * daysSinceJ2000) * DEG

  const pole = raDecToVector(ra, dec)
  // Node of the body equator on the ICRF equator.
  const node: Vec3 = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 }
  const perp = cross(pole, node) // completes the right-handed set

  // Prime meridian, measured eastward from the node.
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const x: Vec3 = {
    x: node.x * cw + perp.x * sw,
    y: node.y * cw + perp.y * sw,
    z: node.z * cw + perp.z * sw,
  }
  const y = cross(pole, x)

  equatorialToEcliptic(pole)
  equatorialToEcliptic(x)
  equatorialToEcliptic(y)

  return { x: normalize(x), y: normalize(y), z: normalize(pole) }
}

/**
 * Orientation for a tidally locked satellite.
 *
 * Rather than carrying per-moon meridian constants we derive the frame from the
 * geometry itself: the sub-parent point defines the prime meridian and the orbit
 * normal defines the pole. That is what tidal locking *means*, and it stays
 * correct for all ~450 satellites without any extra data.
 */
export function tidallyLockedBasis(toParent: Vec3, orbitalVelocity: Vec3): Basis {
  // x-axis: away from the parent (the anti-parent meridian faces outward, and
  // the near side stays fixed — either convention is a 180 degree texture
  // rotation, so we pick the outward one to match the usual sub-planetary
  // longitude definition).
  const x = normalize({ x: -toParent.x, y: -toParent.y, z: -toParent.z })
  // Pole: orbit normal = r x v.
  const z = normalize(cross(toParent, orbitalVelocity))
  const y = cross(z, x)
  return { x, y: normalize(y), z }
}
