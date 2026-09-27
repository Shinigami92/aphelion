/**
 * Thumbstick steering, for VR controllers.
 *
 * Laid out the way a first-person game is: the left stick moves you and the
 * right stick turns you. How far a stick leans is how fast, at the rates the
 * keys use at full tilt.
 *
 *   orbit — the left stick moves in and out: pushed forward it closes in on
 *           the focus, as W does. Its sideways axis does nothing here; a
 *           strafe slid the focus off centre, which read as the planet
 *           drifting away rather than as moving. The right stick swings round
 *           the focus (sideways) and over it (forward and back), as the arrow
 *           keys do.
 *   free  — the left stick flies where you are looking rather than where the
 *           camera points, since in a headset the two differ by however far
 *           your head is turned. The right stick turns (sideways) and looks up
 *           and down (forward and back, not inverted).
 */

import type { CameraState } from './state.ts';
import type { Quaternion } from 'three';
import { Vector3 } from 'three';
import { freeFlightStep, lookBy } from './free.ts';
import { MAX_ELEVATION } from './math.ts';
import { cancelFlight, clampDistance } from './orbit.ts';

/** One stick, each axis in [-1, 1]: +x leans right, +y is pushed forward. */
export interface Stick {
  readonly x: number;
  readonly y: number;
}

export interface StickInput {
  readonly left: Stick;
  readonly right: Stick;
}

/**
 * How far a stick must lean before it counts, as a fraction of full tilt.
 *
 * A stick at rest reads a few percent off centre, and without this a
 * controller put down on the desk would keep the camera creeping for ever.
 */
export const STICK_DEAD_ZONE = 0.15;

/** Orbit at full tilt, radians per second: the arrow keys' rate. */
const ORBIT_RATE = 1.5;
/**
 * Zoom at full tilt, e-folds per second. Between the keys' plain and boosted
 * rates, since a stick has no Shift to reach for.
 */
const ZOOM_RATE = 1.8;
/** Turning and looking up or down at full tilt in free flight, radians per second. */
const TURN_RATE = 1.2;

// Scratch vectors, reused every frame.
const forward = new Vector3();
const right = new Vector3();

/**
 * One raw stick axis with the dead zone taken out. The rest is rescaled to
 * start from zero at the zone's edge, so motion eases in instead of jumping
 * to fifteen percent the moment the stick leaves it.
 */
export function deadZone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= STICK_DEAD_ZONE) {
    return 0;
  }
  return Math.sign(value) * Math.min(1, (magnitude - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
}

function isCentred(input: StickInput): boolean {
  return input.left.x === 0 && input.left.y === 0 && input.right.x === 0 && input.right.y === 0;
}

function steerOrbit(s: CameraState, input: StickInput, dt: number): void {
  s.targetDistance *= Math.exp(-input.left.y * ZOOM_RATE * dt);
  clampDistance(s);

  s.targetAzimuth += input.right.x * ORBIT_RATE * dt;
  s.targetElevation = Math.max(
    -MAX_ELEVATION,
    Math.min(MAX_ELEVATION, s.targetElevation + input.right.y * ORBIT_RATE * dt),
  );
}

function steerFree(s: CameraState, input: StickInput, heading: Quaternion, dt: number): void {
  const step = freeFlightStep(s, dt, s.freeSpeedFactor);
  forward.set(0, 0, -1).applyQuaternion(heading);
  right.set(1, 0, 0).applyQuaternion(heading);
  s.freePosition
    .addScaledVector(forward, input.left.y * step)
    .addScaledVector(right, input.left.x * step);
  // lookBy pitches down for a positive amount, the way a mouse dragged down
  // does; a stick pushed forward looks up.
  lookBy(s, input.right.x * TURN_RATE * dt, -input.right.y * TURN_RATE * dt);
}

/**
 * Steer the camera by the controllers' sticks for one frame of `dt` seconds.
 *
 * @param heading where the viewer is looking, in render space: the direction
 *   free flight moves in.
 */
export function steerByStick(
  s: CameraState,
  input: StickInput,
  heading: Quaternion,
  dt: number,
): void {
  if (isCentred(input)) {
    return;
  }
  // A stick takes control back the way a drag does; a flight left running
  // would fight it for the rest of its duration.
  cancelFlight(s);
  s.interacted = true;
  s.lastInputAt = performance.now();
  if (s.mode === 'orbit') {
    steerOrbit(s, input, dt);
  } else {
    steerFree(s, input, heading, dt);
  }
}
