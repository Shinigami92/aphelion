/**
 * Thumbstick steering, as VR controllers drive it.
 *
 * Each stick should do what the matching keys do, in the same direction, and
 * free flight should move where the viewer is looking rather than where the
 * camera points, since a headset lets the two differ.
 */

import type { StickInput } from '../src/controls/camera/stick.ts';
import type { SimBody } from '../src/core/system.ts';
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraController } from '../src/controls/camera.ts';
import { deadZone, STICK_DEAD_ZONE } from '../src/controls/camera/stick.ts';
import { SolarSystem } from '../src/core/system.ts';
import { JD_TT, settledAt } from './system-fixture.ts';

const FRAME = 1 / 60;

let system: SolarSystem;

const body = (key: string): SimBody => {
  const found = system.byKey.get(key);
  if (!found) {
    throw new Error(`no body '${key}'`);
  }
  return found;
};

const fresh = (): CameraController => {
  const c = new CameraController(16 / 9);
  c.setFocus(body('earth'), { immediate: true });
  c.update(FRAME);
  return c;
};

/** Free flight from the fresh orbit, with Earth's surface as the clearance. */
const freeAtEarth = (): CameraController => {
  const c = fresh();
  c.toggleMode();
  c.setNearestSurface(c.altitude());
  c.update(FRAME);
  return c;
};

const sticks = (left: [number, number], right: [number, number] = [0, 0]): StickInput => ({
  left: { x: left[0], y: left[1] },
  right: { x: right[0], y: right[1] },
});

/** Steer for `frames` frames with the camera's own orientation as the heading. */
const steer = (c: CameraController, input: StickInput, frames: number): void => {
  for (let i = 0; i < frames; i++) {
    c.steer(input, c.camera.quaternion, FRAME);
    c.update(FRAME);
  }
};

beforeAll(() => {
  system = new SolarSystem();
  system.update(JD_TT, settledAt('explore'));
});

describe('dead zone', () => {
  it('ignores a resting stick and eases in from the edge of the zone', () => {
    expect(deadZone(0.1)).toBe(0);
    expect(deadZone(-STICK_DEAD_ZONE)).toBe(0);
    expect(deadZone(STICK_DEAD_ZONE + 0.01)).toBeCloseTo(0.01 / (1 - STICK_DEAD_ZONE), 12);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
  });
});

describe('orbit mode', () => {
  it('swings round and over the focus the way the arrow keys do', () => {
    const byStick = fresh();
    steer(byStick, sticks([1, 1]), 30);

    const byKeys = fresh();
    byKeys.keys.orbitRight = true;
    byKeys.keys.orbitUp = true;
    for (let i = 0; i < 30; i++) {
      byKeys.update(FRAME);
    }
    expect(byStick.orbitAzimuth).toBeCloseTo(byKeys.orbitAzimuth, 9);
    expect(byStick.orbitElevation).toBeCloseTo(byKeys.orbitElevation, 9);
  });

  it('zooms in when the right stick is pushed forward, and out when pulled back', () => {
    const start = fresh().currentDistance;
    const closer = fresh();
    steer(closer, sticks([0, 0], [0, 1]), 60);
    const further = fresh();
    steer(further, sticks([0, 0], [0, -1]), 60);
    expect(closer.currentDistance).toBeLessThan(start);
    expect(further.currentDistance).toBeGreaterThan(start);
  });

  it('never zooms inside the body', () => {
    const c = fresh();
    steer(c, sticks([0, 0], [0, 1]), 1200);
    expect(c.altitude()).toBeGreaterThan(0);
  });

  it('cancels a flight in progress, but a centred stick does not', () => {
    /** Longer than the longest cinematic flight, which is capped at nine seconds. */
    const outlastAnyFlight = 12 * 60;

    const idle = fresh();
    idle.flyTo(body('mars'));
    steer(idle, sticks([0, 0]), outlastAnyFlight);
    expect(idle.distanceInRadii).toBeLessThan(10);

    // Taken back by the stick, the camera stays out where the flight had got
    // to instead of carrying on to the framing distance.
    const pushed = fresh();
    pushed.flyTo(body('mars'));
    steer(pushed, sticks([0, 0]), 60);
    steer(pushed, sticks([1, 0]), 1);
    steer(pushed, sticks([0, 0]), outlastAnyFlight);
    expect(pushed.distanceInRadii).toBeGreaterThan(1000);
  });
});

describe('free flight', () => {
  it('flies along the heading, not along the camera', () => {
    const c = freeAtEarth();
    const before = c.camera.position.clone();
    const cameraForward = new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
    // Head turned 90 degrees to the right of the camera.
    const heading = c.camera.quaternion
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2));
    const headForward = new Vector3(0, 0, -1).applyQuaternion(heading);

    c.steer(sticks([0, 1]), heading, FRAME);
    c.update(FRAME);
    const moved = c.camera.position.clone().sub(before).normalize();
    expect(moved.dot(headForward)).toBeCloseTo(1, 6);
    expect(Math.abs(moved.dot(cameraForward))).toBeLessThan(1e-6);
  });

  it('turns right with the right stick leaned right', () => {
    const c = freeAtEarth();
    const right = new Vector3(1, 0, 0).applyQuaternion(c.camera.quaternion);
    steer(c, sticks([0, 0], [1, 0]), 10);
    const forward = new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
    expect(forward.dot(right)).toBeGreaterThan(0);
  });
});
