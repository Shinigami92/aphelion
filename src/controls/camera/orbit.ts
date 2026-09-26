/** Orbit mode: focusing a body, easing about it, zoom and pan. */

import type { SimBody } from '../../core/system.ts';
import type { CameraState } from './state.ts';
import { Vector3 } from 'three';
import { MAX_ELEVATION, nearestAngle, orbitOffset } from './math.ts';

/**
 * Focus a body. The default framing puts the body at a comfortable few radii
 * so you can see it and some of its surroundings.
 *
 * Pass `arriveFrom` — a unit vector in the world frame — to say which side to
 * come in on. Without it you arrive on whichever side the previous azimuth
 * happened to point at, which for the outer planets is usually the unlit one:
 * you fly to Saturn and find a black disc.
 *
 * For a body that vector is the direction of the Sun, so you are placed over
 * the daylit hemisphere. It was called `sunward` for that reason, and stopped
 * being: a Lagrange point has no hemispheres, and what matters there is
 * arriving on the far side from its planet, so the marker has the planet — and
 * at L1, L2 and L3 the Sun behind it — in the same frame. Same mechanism, so
 * the caller chooses the direction and this only ever places the camera along
 * it.
 */
export function setFocus(
  s: CameraState,
  body: SimBody,
  opts: {
    immediate?: boolean;
    distanceRadii?: number;
    arriveFrom?: { x: number; y: number; z: number };
  } = {},
): void {
  const previous = s.focus;
  s.focus = body;

  const radius = Math.max(body.sceneRadius, 1e-4);
  const radii = opts.distanceRadii ?? (body.type === 'star' ? 6 : 4.2);
  s.targetDistance = radius * radii;
  s.panOffset.set(0, 0, 0);

  if (opts.arriveFrom) {
    // Just off the line, so most of a planet's disc is lit but the terminator
    // is still in frame — and so a Lagrange marker does not sit exactly on top
    // of the planet it is being measured against.
    const desired = Math.atan2(opts.arriveFrom.y, opts.arriveFrom.x) + 0.6;
    s.targetAzimuth = nearestAngle(s.azimuth, desired);
    s.targetElevation = 0.3;
  }

  if (opts.immediate === true || !previous) {
    s.distance = s.targetDistance;
    s.azimuth = s.targetAzimuth;
    s.elevation = s.targetElevation;
    s.focusTransition = 1;
  } else {
    // Ease in from wherever we were.
    s.focusTransition = 0;
  }
  s.mode = 'orbit';
}

/**
 * Set the current orbit state from a position relative to the focus centre,
 * deliberately leaving the targets alone: the easing then runs from where the
 * camera genuinely is toward the new framing, instead of from angles left
 * over from whatever it was orbiting before.
 */
export function adoptOrbitFrom(s: CameraState, p: Vector3): void {
  s.distance = Math.max(p.length(), 1e-4);
  // Azimuth is a running total, not a wrapped angle — dragging winds it past
  // a turn and `setFocus` stores its target as whichever representative was
  // nearest at the time, so `targetAzimuth` is regularly outside (-π, π].
  // atan2 is not, and reading the arrival angle raw therefore left the two a
  // whole turn apart while describing the same direction: the camera reached
  // its destination and the orbit easing then spun it a full 360° about the
  // body to unwind the difference. Choosing the representative nearest the
  // target keeps the direction identical and makes "already there" read as
  // nothing left to travel.
  s.azimuth = nearestAngle(s.targetAzimuth, Math.atan2(p.y, p.x));
  s.elevation = Math.asin(Math.max(-1, Math.min(1, p.z / s.distance)));
}

/** Re-derive azimuth, elevation and distance from the camera's position. */
export function adoptOrbitFromPosition(s: CameraState): void {
  adoptOrbitFrom(s, s.camera.position.clone().sub(s.panOffset));
  s.targetDistance = s.distance;
  s.targetAzimuth = s.azimuth;
  s.targetElevation = s.elevation;
}

/** Frame a body and all of its satellites. */
export function frameSystem(s: CameraState, body: SimBody, maxChildDistance: number): void {
  s.focus = body;
  s.targetDistance = Math.max(body.sceneRadius * 3, maxChildDistance * 1.6);
  s.panOffset.set(0, 0, 0);
  s.mode = 'orbit';
}

/**
 * Arrow keys orbit and +/- zoom; WASD, R and F drive the same controls, so
 * one hand can do everything.
 */
function steerFromKeys(s: CameraState, rate: number, zoomRate: number): void {
  if (s.keys.orbitLeft) {
    s.targetAzimuth -= rate;
  }
  if (s.keys.orbitRight) {
    s.targetAzimuth += rate;
  }
  if (s.keys.orbitUp) {
    s.targetElevation = Math.min(MAX_ELEVATION, s.targetElevation + rate);
  }
  if (s.keys.orbitDown) {
    s.targetElevation = Math.max(-MAX_ELEVATION, s.targetElevation - rate);
  }
  if (s.keys.zoomIn) {
    s.targetDistance /= zoomRate;
  }
  if (s.keys.zoomOut) {
    s.targetDistance *= zoomRate;
  }

  if (s.keys.forward) {
    s.targetDistance /= zoomRate;
  }
  if (s.keys.back) {
    s.targetDistance *= zoomRate;
  }
  if (s.keys.left) {
    s.targetAzimuth -= rate;
  }
  if (s.keys.right) {
    s.targetAzimuth += rate;
  }
  if (s.keys.up) {
    s.targetElevation = Math.min(MAX_ELEVATION, s.targetElevation + rate);
  }
  if (s.keys.down) {
    s.targetElevation = Math.max(-MAX_ELEVATION, s.targetElevation - rate);
  }
}

export function clampDistance(s: CameraState): void {
  const minimum = s.focus ? s.focus.sceneRadius * 1.02 : 1e-4;
  s.targetDistance = Math.max(minimum, Math.min(s.targetDistance, 4e7));
}

/** One frame of orbit mode: keys, easing, and placing the camera. */
export function updateOrbit(s: CameraState, dt: number): void {
  const k = 1 - Math.exp(-dt / 0.09);

  // Keyboard orbiting and zoom.
  const speed = s.keys.precise ? 0.25 : s.keys.boost ? 3 : 1;
  const rate = 1.5 * dt * speed;
  const zoomRate = Math.exp((s.keys.boost ? 2.4 : 1.1) * dt);
  steerFromKeys(s, rate, zoomRate);

  // Q and E roll here as well as in free flight; they used to be ignored in
  // orbit mode, which made the horizon feel nailed down.
  const rollRate = 1.4 * dt * speed;
  if (s.keys.rollLeft) {
    s.targetRoll -= rollRate;
  }
  if (s.keys.rollRight) {
    s.targetRoll += rollRate;
  }

  clampDistance(s);

  s.azimuth += (s.targetAzimuth - s.azimuth) * k;
  s.elevation += (s.targetElevation - s.elevation) * k;
  s.distance += (s.targetDistance - s.distance) * k;
  s.roll += (s.targetRoll - s.roll) * k;
  s.focusTransition += (1 - s.focusTransition) * k;

  const offset = orbitOffset(s.distance, s.azimuth, s.elevation);

  // The focus sits at the render-space origin.
  s.camera.position.copy(offset).add(s.panOffset);
  s.camera.up.set(0, 0, 1);
  s.camera.lookAt(s.panOffset);
  // Roll about the view axis, applied after the look, which has just
  // discarded any previous rotation. Negated because the camera's local +z
  // points *backward* along the view, so a positive rotation about it turns
  // the opposite way to free flight, which rolls about the forward vector.
  if (s.roll !== 0) {
    s.camera.rotateZ(-s.roll);
  }
  s.freePosition.copy(s.camera.position);
  s.freeQuaternion.copy(s.camera.quaternion);
}

export function zoomBy(s: CameraState, factor: number): void {
  s.targetDistance *= factor;
  clampDistance(s);
}

/** Pan in the camera plane, scaled so the movement tracks the finger. */
export function panByScreen(s: CameraState, dx: number, dy: number): void {
  const scale = s.distance * 0.0016;
  const right = new Vector3().setFromMatrixColumn(s.camera.matrix, 0);
  const up = new Vector3().setFromMatrixColumn(s.camera.matrix, 1);
  s.panOffset.addScaledVector(right, -dx * scale);
  s.panOffset.addScaledVector(up, dy * scale);
}
