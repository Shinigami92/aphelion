/** Camera constants and the pure maths behind orbiting and flying. */

import { Vector3 } from 'three';

export const DEG = Math.PI / 180;
export const MAX_ELEVATION = 89.5 * DEG;

/**
 * Free-flight speed as a fraction of the clearance ahead, per second.
 *
 * 0.15 means you close about 15% of the gap to the nearest surface each second,
 * so an Earth-to-Mars crossing runs a little over ten seconds unboosted while a
 * final approach decays smoothly to a crawl. Shift multiplies it eightfold.
 */
export const FREE_SPEED_PER_UNIT = 0.15;
/** Enough to still manoeuvre when parked against a surface. */
export const MIN_FREE_SPEED = 0.05;
/** Keeps deep Kuiper emptiness from producing an unusable jump per frame. */
export const MAX_FREE_SPEED = 30_000;
/**
 * How far the wheel can turn free-flight speed down or up, as a multiplier.
 *
 * It scales the clearance-derived speed rather than replacing it, so flight
 * still slows on the approach at any setting. Six doublings each way covers
 * creeping along a ring and crossing the Kuiper belt, and the step cap below
 * holds at the top end.
 */
export const FREE_SPEED_FACTOR_RANGE = [1 / 64, 64] as const;
/**
 * Most of the remaining gap a single frame may close. Below 1 this is a
 * geometric approach, so the surface is a limit rather than a thing you hit —
 * and it holds however hard the boost key is pressed.
 */
export const MAX_STEP_FRACTION = 0.35;

/**
 * How close to the arrival point already counts as being there, as a fraction
 * of the framing distance. Under this a flight would be a twitch, so the orbit
 * easing covers it instead.
 */
export const ARRIVED_FRACTION = 0.25;

/**
 * Seconds for a cinematic approach, from the trip length in destination radii.
 *
 * Logarithmic, because the range is enormous — a few radii to a moon, tens of
 * millions to cross the system — and clamped so nothing is either a jump cut or
 * a wait. Earth to Mars lands around eight seconds.
 */
export function flightDuration(radiiTravelled: number): number {
  const decades = Math.log10(Math.max(radiiTravelled, 1));
  return Math.max(2.2, Math.min(9, 1.8 + decades * 1.5));
}

/**
 * The representative of `target` closest to `current`, so easing to a new
 * azimuth always takes the short way round rather than unwinding several turns.
 */
export function nearestAngle(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) {
    delta -= twoPi;
  }
  if (delta < -Math.PI) {
    delta += twoPi;
  }
  return current + delta;
}

/** Spherical orbit state to a Cartesian offset from the focus, z up. */
export function orbitOffset(
  distance: number,
  azimuth: number,
  elevation: number,
  out = new Vector3(),
): Vector3 {
  const cosE = Math.cos(elevation);
  return out.set(
    distance * cosE * Math.cos(azimuth),
    distance * cosE * Math.sin(azimuth),
    distance * Math.sin(elevation),
  );
}
