/** The per-frame solve: positions, orientations, the scale remap and the Lagrange points. */

import type { Vec3 } from '../../astro/kepler.ts';
import type { ScaleModel } from '../scale.ts';
import type { SimBody } from '../system.ts';
import { applyBasis, spinBasis, tidallyLockedBasis } from '../../astro/frames.ts';
import { positionAtTime, velocityAtTime } from '../../astro/kepler.ts';
import { moonGeocentric, moonGeocentricVelocity } from '../../astro/moon.ts';
import { planetPosition } from '../../astro/planets.ts';
import { addTo, copy, isPlanetKey, length, zero } from './body.ts';

const tmpA: Vec3 = { x: 0, y: 0, z: 0 };
const tmpB: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Place every Lagrange point for the instant just solved.
 *
 * The rotating frame is rebuilt from the pair's real geometry each time
 * rather than assumed: the separation `R` is the *instantaneous* one, so the
 * whole configuration breathes in and out with the planet's eccentricity, and
 * the orbit normal comes from r x v, so the points track the plane rather
 * than sitting in a nominal ecliptic. That makes these the points of the
 * circular problem evaluated at the current separation — which is what
 * everyone means by "Sun-Earth L2", and what its 1.5 million km refers to.
 *
 * Note the frame is right-handed by construction: `w` is the orbit normal
 * crossed into the radial direction, which for any orbit is the direction of
 * travel. That is what makes L4 *lead* the planet by 60 degrees and L5 trail
 * it, rather than the other way round — and getting it backwards would put
 * Jupiter's L4 marker in the middle of the Trojan camp instead of the Greek
 * one, with nothing else on screen looking any different.
 */
export function updateLagrange(points: ReadonlyArray<SimBody>, scale: ScaleModel): void {
  for (const point of points) {
    if (placeLagrangePoint(point)) {
      remapLagrangePoint(point, scale);
    }
  }
}

/**
 * Put a point where it belongs in its pair's rotating frame, in heliocentric
 * km. Returns false when the pair is degenerate and the point cannot be placed.
 */
function placeLagrangePoint(point: SimBody): boolean {
  const info = point.lagrange!;
  const primary = info.primary;
  const secondary = info.secondary;

  const rx = secondary.helioKm.x - primary.helioKm.x;
  const ry = secondary.helioKm.y - primary.helioKm.y;
  const rz = secondary.helioKm.z - primary.helioKm.z;
  const R = Math.hypot(rx, ry, rz);
  if (R < 1) {
    return false;
  }

  const ux = rx / R;
  const uy = ry / R;
  const uz = rz / R;

  const vx = secondary.velKm.x - primary.velKm.x;
  const vy = secondary.velKm.y - primary.velKm.y;
  const vz = secondary.velKm.z - primary.velKm.z;
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);
  if (h < 1e-9) {
    return false;
  }
  const nx = hx / h;
  const ny = hy / h;
  const nz = hz / h;

  // In-plane, perpendicular to the radius, along the direction of travel.
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;

  // The nondimensional frame has its origin at the barycentre, which for a
  // Sun-planet pair sits just inside the Sun — but not at its centre, and
  // the offset is exactly what puts L3 slightly beyond one orbit radius.
  const bx = primary.helioKm.x + info.massRatio * rx;
  const by = primary.helioKm.y + info.massRatio * ry;
  const bz = primary.helioKm.z + info.massRatio * rz;

  const g = info.rotating;
  point.helioKm.x = bx + R * (g.x * ux + g.y * wx);
  point.helioKm.y = by + R * (g.x * uy + g.y * wy);
  point.helioKm.z = bz + R * (g.x * uz + g.y * wz);
  return true;
}

/** Derive the planet-relative and scene positions from the heliocentric one. */
function remapLagrangePoint(point: SimBody, scale: ScaleModel): void {
  const secondary = point.lagrange!.secondary;
  point.localKm.x = point.helioKm.x - secondary.helioKm.x;
  point.localKm.y = point.helioKm.y - secondary.helioKm.y;
  point.localKm.z = point.helioKm.z - secondary.helioKm.z;

  // Remapped as the heliocentric body it is, not as a satellite of its
  // planet: L4 and L5 are a full orbit radius from the planet, and L3 is
  // two. Going through the satellite law would compress them into the
  // planet's lap. This also keeps L4 and L5 exactly on the planet's own
  // drawn orbit, since the remap is radial and they share its radius.
  const r = length(point.helioKm);
  const f = r > 0 ? scale.heliocentricDistance(r) / r : 0;
  point.scene.x = point.helioKm.x * f;
  point.scene.y = point.helioKm.y * f;
  point.scene.z = point.helioKm.z * f;
  point.sceneRadius = scale.bodyRadius(point.radiusKm);
}

export function solvePosition(body: SimBody, sun: SimBody, jdTT: number): void {
  if (body === sun) {
    zero(body.helioKm);
    zero(body.localKm);
    zero(body.velKm);
    return;
  }

  // Planets (and Pluto) come from the JPL Keplerian theory.
  if (body.spec && isPlanetKey(body.spec.key)) {
    planetPosition(body.spec.key, jdTT, body.helioKm);
    copy(body.localKm, body.helioKm);
    // Finite-difference velocity, good enough for orientation and readouts.
    planetPosition(body.spec.key, jdTT + 0.5, tmpA);
    planetPosition(body.spec.key, jdTT - 0.5, tmpB);
    body.velKm.x = tmpA.x - tmpB.x;
    body.velKm.y = tmpA.y - tmpB.y;
    body.velKm.z = tmpA.z - tmpB.z;
    return;
  }

  // Earth's Moon gets the full lunar theory rather than mean elements.
  if (body.key === 'moon:Moon') {
    moonGeocentric(jdTT, body.localKm);
    moonGeocentricVelocity(jdTT, body.velKm);
    addTo(body.helioKm, body.parent!.helioKm, body.localKm);
    return;
  }

  if (!body.elements) {
    zero(body.helioKm);
    zero(body.localKm);
    return;
  }

  // Everything else: mean elements in their own reference plane.
  positionAtTime(body.elements, jdTT, tmpA);
  applyBasis(body.basis, tmpA.x, tmpA.y, tmpA.z, body.localKm);

  velocityAtTime(body.elements, jdTT, tmpB);
  applyBasis(body.basis, tmpB.x, tmpB.y, tmpB.z, body.velKm);

  if (body.parent && body.parent !== sun) {
    addTo(body.helioKm, body.parent.helioKm, body.localKm);
  } else {
    copy(body.helioKm, body.localKm);
  }
}

export function solveOrientation(body: SimBody, days: number, centuries: number): void {
  if (body.spec) {
    body.orientation = spinBasis(body.spec.spin, days, centuries);
    return;
  }
  if (body.type === 'moon') {
    // Tidal locking derived from the geometry; correct for essentially every
    // satellite large enough for anyone to notice, and free of extra data. The
    // parent's pole only disambiguates north from south, and it is available
    // here because `ordered` is depth-first, so the parent is already solved.
    body.orientation = tidallyLockedBasis(
      body.localKm,
      body.velKm,
      body.parent?.spec ? body.parent.orientation.z : null,
    );
    return;
  }
  // Minor planets: no measured pole for most, so spin about the ecliptic pole
  // at a plausible rate seeded by the body's own elements.
  const rate = 40 + ((body.small?.h ?? 10) % 7) * 130;
  body.orientation = spinBasis({ poleRa: 0, poleDec: 90, w0: 0, wDot: rate }, days, centuries);
}

export function applyScale(body: SimBody, sun: SimBody, scale: ScaleModel): void {
  body.sceneRadius = scale.bodyRadius(body.radiusKm);

  if (body === sun) {
    zero(body.scene);
    return;
  }

  const parent = body.parent!;
  if (parent === sun) {
    const r = length(body.helioKm);
    const f = r > 0 ? scale.heliocentricDistance(r) / r : 0;
    body.scene.x = body.helioKm.x * f;
    body.scene.y = body.helioKm.y * f;
    body.scene.z = body.helioKm.z * f;
    return;
  }

  const rLocal = length(body.localKm);
  const f = rLocal > 0 ? scale.satelliteDistance(rLocal, parent.radiusKm) / rLocal : 0;
  body.scene.x = parent.scene.x + body.localKm.x * f;
  body.scene.y = parent.scene.y + body.localKm.y * f;
  body.scene.z = parent.scene.z + body.localKm.z * f;
}
