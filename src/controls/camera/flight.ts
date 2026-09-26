/** Cinematic flights: crossing to a body over a few seconds instead of cutting to it. */

import type { SimBody } from '../../core/system.ts';
import type { CameraState, Flight } from './state.ts';
import type { Vector3 } from 'three';
import { PerspectiveCamera, Quaternion } from 'three';
import { ARRIVED_FRACTION, flightDuration, orbitOffset } from './math.ts';
import { adoptOrbitFrom, adoptOrbitFromPosition, setFocus } from './orbit.ts';

/**
 * Where the camera is now, relative to the destination — captured before
 * the focus changes, because that is the frame the flight is flown in.
 * The renderer centres the world on the focus, so the camera's position is
 * relative to `previous`; shifting by the gap between the two bodies puts it
 * in the destination's frame, which is where the whole flight is computed.
 */
function startInDestinationFrame(s: CameraState, body: SimBody): Vector3 {
  const previous = s.focus;
  const from = s.camera.position.clone();
  if (previous && previous !== body) {
    from.x += previous.scene.x - body.scene.x;
    from.y += previous.scene.y - body.scene.y;
    from.z += previous.scene.z - body.scene.z;
  }
  return from;
}

/** Hand the camera to a flight from `from`, towards the framing `setFocus` just chose. */
function beginFlight(
  s: CameraState,
  body: SimBody,
  from: Vector3,
  fromQuaternion: Quaternion,
  trip: number,
  onArrive: (() => void) | undefined,
): void {
  s.flight = {
    elapsed: 0,
    duration: flightDuration(trip / Math.max(body.sceneRadius, 1e-4)),
    fromPosition: from,
    fromQuaternion,
    toDistance: s.targetDistance,
    toAzimuth: s.targetAzimuth,
    toElevation: s.targetElevation,
    onArrive,
  };
  // Start the eased state at the far end so a cancelled flight does not snap.
  s.distance = from.length();
  s.mode = 'orbit';
}

/**
 * Fly to a body instead of cutting to it: turn toward it, cross the distance
 * over several seconds, and settle into the framing `setFocus` would have
 * chosen.
 *
 * The duration comes from how far the trip actually is in units of the
 * destination's own size, so hopping to a nearby moon stays brisk while Mars
 * to Earth takes the better part of ten seconds. Interrupting is deliberate:
 * any drag, key or wheel cancels the flight and leaves the camera wherever it
 * had reached, rather than fighting the user for the remaining seconds.
 */
export function flyTo(
  s: CameraState,
  body: SimBody,
  opts: { arriveFrom?: { x: number; y: number; z: number }; onArrive?: () => void } = {},
): void {
  const from = startInDestinationFrame(s, body);

  const fromQuaternion = s.camera.quaternion.clone();

  // Let setFocus pick the destination framing, then take the numbers back.
  setFocus(s, body, { ...opts, immediate: true });

  // Where the flight would end, in the same frame `from` is measured in.
  const to = orbitOffset(s.targetDistance, s.targetAzimuth, s.targetElevation);
  const trip = from.distanceTo(to);

  // Whether there is anything to fly is the gap between where the camera is
  // and where it is going — not its range from the destination, which is what
  // this used to compare. The two part company whenever the framing distance
  // is large next to the trip, and a Lagrange point is exactly that case: its
  // radius is a viewing scale off the Hill radius, not a size, so the default
  // 4.2-radii framing sits further from Earth's L1 than L1 is from Earth.
  // Every trip to an L1 or L2 therefore measured as "already framed" and cut
  // straight there — a jump, from the wrong side, with no flight at all.
  if (trip < s.targetDistance * ARRIVED_FRACTION) {
    // Close enough that flying would be a twitch, but still no reason to
    // snap: take the current angles from where the camera actually is in the
    // destination's frame and let the orbit easing close the rest.
    adoptOrbitFrom(s, from);
    opts.onArrive?.();
    return;
  }

  beginFlight(s, body, from, fromQuaternion, trip, opts.onArrive);
}

/** Abandon a flight in progress, keeping wherever the camera has reached. */
export function cancelFlight(s: CameraState): void {
  if (!s.flight) {
    return;
  }
  s.flight = null;
  adoptOrbitFromPosition(s);
  s.travelIntensity = 0;
}

/**
 * Interpolate the direction on the sphere and the radius in log space, so
 * the crossing reads as steady progress rather than a sudden arrival.
 *
 * The direction has to be a genuine rotation. Lerping the two unit vectors
 * and renormalising traces the same arc for a modest turn, but it sags
 * through the middle as the angle opens — and a trip to a Lagrange point is
 * a turn of well over a hundred degrees, because you arrive on the far side
 * from the planet you set out from. At a half-turn the midpoint collapses
 * onto the origin and the camera passes through what it is arriving at.
 */
function swingPosition(s: CameraState, fromPosition: Vector3, to: Vector3, ease: number): number {
  const fromLength = Math.max(fromPosition.length(), 1e-6);
  const toLength = Math.max(to.length(), 1e-6);
  const direction = fromPosition.clone().divideScalar(fromLength);
  const swing = new Quaternion().setFromUnitVectors(
    direction.clone(),
    to.clone().divideScalar(toLength),
  );
  direction.applyQuaternion(new Quaternion().slerp(swing, ease));
  const radius = Math.exp(
    Math.log(fromLength) + (Math.log(toLength) - Math.log(fromLength)) * ease,
  );
  s.camera.position.copy(direction).multiplyScalar(radius).add(s.panOffset);
  return radius;
}

/** The flight is over: settle into orbit exactly where it ended. */
function arrive(s: CameraState, f: Flight): void {
  s.flight = null;
  s.travelIntensity = 0;
  s.roll = 0;
  s.targetRoll = 0;
  adoptOrbitFromPosition(s);
  s.targetDistance = f.toDistance;
  s.targetAzimuth = f.toAzimuth;
  s.targetElevation = f.toElevation;
  f.onArrive?.();
}

/**
 * One frame of a cinematic approach.
 *
 * Two curves, deliberately out of step. The orientation resolves early — a
 * front-loaded ease, so the camera has turned to face the destination within
 * the first third and you spend the rest of the trip watching it grow. The
 * position uses a slow-in/slow-out curve applied to the *logarithm* of the
 * distance, because at these scales a linear approach spends almost all its
 * time as an indistinguishable speck and then arrives all at once.
 */
export function updateFlight(s: CameraState, dt: number): void {
  const f = s.flight!;
  f.elapsed += dt;
  const t = Math.min(1, f.elapsed / f.duration);

  const ease = t * t * (3 - 2 * t);
  // Turning finishes at a third of the way, then holds.
  const turn = Math.min(1, ease * 3);

  // Destination position in the same frame the flight started in.
  const to = orbitOffset(f.toDistance, f.toAzimuth, f.toElevation);

  const radius = swingPosition(s, f.fromPosition, to, ease);

  // Orientation: from wherever we were looking, to facing the destination.
  s.camera.up.set(0, 0, 1);
  const aimed = new PerspectiveCamera();
  aimed.up.set(0, 0, 1);
  aimed.position.copy(s.camera.position);
  aimed.lookAt(s.panOffset);
  s.camera.quaternion.copy(f.fromQuaternion).slerp(aimed.quaternion, turn);

  // Fast in the middle, still at both ends — what the dust field reacts to.
  s.travelIntensity = Math.sin(Math.PI * t) ** 0.7;

  s.distance = radius;
  s.focusTransition = 1;

  if (t >= 1) {
    arrive(s, f);
  }
}
