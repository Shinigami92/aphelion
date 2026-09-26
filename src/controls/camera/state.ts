/**
 * Everything the camera modules share: the Three.js camera itself, the orbit
 * and free-flight poses, and whatever flight is in progress.
 *
 * One instance per `CameraController`, handed to each module by reference, so
 * the orbit easing, free flight, cinematic flights, the shared-view restore and
 * the pointer input all read and write the same numbers.
 */

import type { SimBody } from '../../core/system.ts';
import type { CameraKeyState } from './keys.ts';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { emptyKeys } from './keys.ts';

export type CameraMode = 'orbit' | 'free';

/**
 * A cinematic approach in progress.
 *
 * Focus switches to the destination the moment a flight starts, so the world
 * is already centred there and every coordinate below is stable for the whole
 * trip; the camera is then flown by hand from wherever it was to the framing
 * position, and handed back to the orbit controller on arrival.
 */
export interface Flight {
  elapsed: number;
  duration: number;
  fromPosition: Vector3;
  fromQuaternion: Quaternion;
  toDistance: number;
  toAzimuth: number;
  toElevation: number;
  /** Fires once the camera settles into orbit, not if the flight is cancelled. */
  onArrive?: () => void;
}

export class CameraState {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'orbit';
  keys: CameraKeyState = emptyKeys();

  /** Body the camera orbits. See `CameraController.focus`. */
  focus: SimBody | null = null;

  /** Distance from the focus centre, in scene units. */
  distance = 40;
  targetDistance = 40;
  /** Azimuth and elevation of the camera about the focus, radians. */
  azimuth = 0.6;
  elevation = 0.32;
  targetAzimuth = 0.6;
  targetElevation = 0.32;

  /**
   * Roll about the view axis while orbiting, radians.
   *
   * Orbit mode pins `up` to ecliptic north and re-runs `lookAt` every frame, so
   * roll cannot live in the quaternion the way it does in free flight — it is
   * re-applied after the look, on top of a fresh orientation.
   */
  roll = 0;
  targetRoll = 0;

  /** Pan offset from the focus centre, in the camera's own basis. */
  readonly panOffset = new Vector3();

  /** Free-flight state. */
  readonly freePosition = new Vector3(0, -400, 120);
  readonly freeQuaternion = new Quaternion();
  /** Wheel-set multiplier on the free-flight step. See FREE_SPEED_FACTOR_RANGE. */
  freeSpeedFactor = 1;

  /** Smoothed follow of the focus so scale transitions do not snap. */
  focusTransition = 0;

  flight: Flight | null = null;

  /** 0 while parked, rising to 1 at the fastest part of a flight. */
  travelIntensity = 0;

  /**
   * Distance to the nearest body's surface, scene units, in free flight.
   * Supplied per frame by the caller, which is the thing that owns the system.
   * Negative when the camera is inside a body.
   */
  nearestSurface = Infinity;

  /** performance.now() of the last real user input. */
  lastInputAt = -Infinity;

  /** Set when the user changes the view, so the UI can hide hints. */
  interacted = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.01, 1e9);
    this.camera.up.set(0, 0, 1); // ecliptic north is +z in our frame
  }
}
