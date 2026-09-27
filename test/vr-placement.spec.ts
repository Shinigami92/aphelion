/**
 * Where the VR panel goes: the pure placement maths behind the follow and
 * pinned placements (src/ui/xr/placement.ts). The wrist placement is a fixed
 * offset in the controller's grip space, so there is nothing to compute.
 */

import type { FollowState, Pose } from '../src/ui/xr/placement.ts';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FOLLOW_THRESHOLD,
  headingOf,
  PANEL_DISTANCE,
  PANEL_DROP,
  PLACEMENTS,
  poseAt,
  stepFollow,
  wrapAngle,
} from '../src/ui/xr/placement.ts';

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

/** A head turned `yaw` about the vertical, then pitched by `pitch`. */
const head = (yaw: number, pitch = 0): Quaternion =>
  new Quaternion()
    .setFromAxisAngle(UP, yaw)
    .multiply(new Quaternion().setFromAxisAngle(RIGHT, pitch));

const pose = (): Pose => ({ position: new Vector3(), quaternion: new Quaternion() });

describe('placements', () => {
  it('offers the wrist first, as the default', () => {
    expect(PLACEMENTS[0]).toBe('wrist');
    expect([...PLACEMENTS].toSorted()).toEqual(['follow', 'pinned', 'wrist']);
  });
});

describe('wrapAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
  });
});

describe('headingOf', () => {
  it('reads the yaw of the head, 0 looking down -z', () => {
    expect(headingOf(head(0))).toBeCloseTo(0, 12);
    expect(headingOf(head(40 * DEG))).toBeCloseTo(40 * DEG, 12);
    expect(headingOf(head(-100 * DEG))).toBeCloseTo(-100 * DEG, 12);
  });

  it('ignores pitch, and keeps the last heading when looking straight up', () => {
    expect(headingOf(head(30 * DEG, -35 * DEG))).toBeCloseTo(30 * DEG, 12);
    expect(headingOf(head(30 * DEG, 89.9 * DEG), 0.25)).toBe(0.25);
  });
});

describe('poseAt', () => {
  it('puts the panel in front of the eye along the heading, a little below it', () => {
    const eye = new Vector3(0.1, 1.6, -0.2);
    const heading = 60 * DEG;
    const out = poseAt(eye, heading, pose());
    const offset = out.position.clone().sub(eye);
    expect(offset.y).toBeCloseTo(-PANEL_DROP, 12);
    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(PANEL_DISTANCE, 12);
    const forward = new Vector3(0, 0, -1).applyQuaternion(head(heading));
    expect(offset.x / PANEL_DISTANCE).toBeCloseTo(forward.x, 12);
    expect(offset.z / PANEL_DISTANCE).toBeCloseTo(forward.z, 12);
  });

  it('turns the panel face square to the line of sight', () => {
    const eye = new Vector3(0, 1.6, 0);
    const out = poseAt(eye, 25 * DEG, pose());
    const face = new Vector3(0, 0, 1).applyQuaternion(out.quaternion);
    const toEye = eye.clone().sub(out.position).normalize();
    expect(face.dot(toEye)).toBeCloseTo(1, 12);
  });
});

/** Follow a head held at `heading` for `seconds` of 90 Hz frames. */
const settle = (state: FollowState, heading: number, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 90) {
    stepFollow(state, heading, 1 / 90);
  }
};

describe('stepFollow', () => {
  it('waits while the head only glances away', () => {
    const state: FollowState = { heading: 0, catchingUp: false };
    settle(state, FOLLOW_THRESHOLD * 0.9, 2);
    expect(state.heading).toBe(0);
    expect(state.catchingUp).toBe(false);
  });

  it('swings back in front once the heading wanders past the threshold, then rests', () => {
    const state: FollowState = { heading: 0, catchingUp: false };
    const target = FOLLOW_THRESHOLD * 1.5;
    settle(state, target, 3);
    expect(state.heading).toBeCloseTo(target, 1);
    expect(state.catchingUp).toBe(false);
  });

  it('takes the short way round across ±π', () => {
    const state: FollowState = { heading: 170 * DEG, catchingUp: false };
    stepFollow(state, -130 * DEG, 1 / 90);
    // 60° clockwise past the seam, not 300° back the other way.
    expect(state.catchingUp).toBe(true);
    expect(wrapAngle(state.heading - 170 * DEG)).toBeGreaterThan(0);
  });
});
