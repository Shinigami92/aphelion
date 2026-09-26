/** Free flight: six degrees of freedom, with speed set by how much room there is. */

import type { CameraMode, CameraState } from './state.ts';
import { Quaternion, Vector3 } from 'three';
import { FREE_SPEED_PER_UNIT, MAX_FREE_SPEED, MAX_STEP_FRACTION, MIN_FREE_SPEED } from './math.ts';

/**
 * How far free flight moves this frame, derived from how much room there is.
 *
 * A fixed speed cannot serve both jobs at this scale. 200 units/s took six
 * minutes to cross from Earth to Mars, and was still fast enough to pass
 * straight through a planet on arrival. Scaling with the clearance to the
 * nearest surface gives one rule that does both: open space is fast, and the
 * approach decays geometrically.
 *
 * The step is capped at a fraction of the remaining gap as well as by speed,
 * and that cap is what actually prevents a collision. Speed alone does not:
 * a minimum speed has to exist so you can still manoeuvre when parked, and
 * that floor will happily carry you through the last few hundred kilometres
 * once the asymptote drops below it — measured at 940 m of penetration into
 * Earth before this cap existed.
 */
function freeFlightStep(s: CameraState, dt: number, boost: number): number {
  const clearance = Number.isFinite(s.nearestSurface) ? s.nearestSurface : Math.max(s.distance, 1);

  // Already inside something: damping would trap you there, so fly freely.
  if (clearance <= 0) {
    return Math.max(MIN_FREE_SPEED, Math.abs(clearance)) * boost * dt;
  }

  const speed = Math.min(clearance * FREE_SPEED_PER_UNIT, MAX_FREE_SPEED);
  return Math.min(Math.max(speed, MIN_FREE_SPEED) * boost * dt, clearance * MAX_STEP_FRACTION);
}

function rollFree(s: CameraState, amount: number): void {
  const axis = new Vector3(0, 0, -1).applyQuaternion(s.freeQuaternion);
  s.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(axis, amount));
}

/** One frame of free flight: move by the clearance ahead, and roll. */
export function updateFree(s: CameraState, dt: number): void {
  const boost = s.keys.boost ? 8 : s.keys.precise ? 0.12 : 1;
  const step = freeFlightStep(s, dt, boost);

  const forward = new Vector3(0, 0, -1).applyQuaternion(s.freeQuaternion);
  const right = new Vector3(1, 0, 0).applyQuaternion(s.freeQuaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(s.freeQuaternion);

  if (s.keys.forward) {
    s.freePosition.addScaledVector(forward, step);
  }
  if (s.keys.back) {
    s.freePosition.addScaledVector(forward, -step);
  }
  if (s.keys.right) {
    s.freePosition.addScaledVector(right, step);
  }
  if (s.keys.left) {
    s.freePosition.addScaledVector(right, -step);
  }
  if (s.keys.up) {
    s.freePosition.addScaledVector(up, step);
  }
  if (s.keys.down) {
    s.freePosition.addScaledVector(up, -step);
  }

  const roll = 1.4 * dt * (s.keys.boost ? 2 : 1);
  if (s.keys.rollLeft) {
    rollFree(s, -roll);
  }
  if (s.keys.rollRight) {
    rollFree(s, roll);
  }

  s.camera.position.copy(s.freePosition);
  s.camera.quaternion.copy(s.freeQuaternion);
  // Keep the orbit state coherent so switching back is not jarring.
  s.distance = Math.max(s.freePosition.length(), 1e-4);
  s.targetDistance = s.distance;
}

/** Turn the free camera by a drag, about its own axes. */
export function lookBy(s: CameraState, yaw: number, pitch: number): void {
  const yawAxis = new Vector3(0, 1, 0).applyQuaternion(s.freeQuaternion);
  const pitchAxis = new Vector3(1, 0, 0).applyQuaternion(s.freeQuaternion);
  s.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(yawAxis, -yaw));
  s.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(pitchAxis, -pitch));
  s.freeQuaternion.normalize();
}

/** Switch between orbiting and free flight, carrying the pose across. */
export function toggleMode(s: CameraState): CameraMode {
  if (s.mode === 'orbit') {
    s.mode = 'free';
    s.freePosition.copy(s.camera.position);
    s.freeQuaternion.copy(s.camera.quaternion);
    // Scale flight speed to whatever we are looking at.
    s.freeSpeed = Math.max(s.distance * 0.35, 1);
  } else {
    s.mode = 'orbit';
  }
  return s.mode;
}

/** Point the free camera at the render-space origin. */
export function lookAtFocus(s: CameraState): void {
  if (s.mode !== 'free') {
    return;
  }
  const m = s.camera.clone();
  m.position.copy(s.freePosition);
  m.up.set(0, 0, 1);
  m.lookAt(0, 0, 0);
  s.freeQuaternion.copy(m.quaternion);
}
