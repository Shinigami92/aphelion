/**
 * Where the VR panel sits. Three placements, switchable while you wear the
 * headset, because which one feels right is something to try rather than to
 * decide on paper:
 *
 *   wrist  — the default, and the one that felt best in the headset: held
 *            by the left controller like a tablet; raise the hand to read it,
 *            point at it with the right.
 *   follow — body-locked, lazily: it keeps its distance and waits while you
 *            glance about, and only swings back in front of you once your
 *            heading has wandered further than a comfortable glance.
 *   pinned — put down in front of you when summoned, and left there in the
 *            room: turn away and it stays behind.
 *
 * All positions are in the viewer's room frame (the overlay rig: metres, +y
 * up, since the session's 'local' reference space is gravity-aligned). The
 * maths is pure so it can be tested without a headset.
 */

import type { Quaternion, Vector3 } from 'three';
import { Euler, Vector3 as Vec3 } from 'three';

export type Placement = 'wrist' | 'follow' | 'pinned';

/** In the order the View tab offers them, the default first. */
export const PLACEMENTS: ReadonlyArray<Placement> = ['wrist', 'follow', 'pinned'];

/** How far in front of the eyes a following or pinned panel sits, metres. */
export const PANEL_DISTANCE = 0.75;
/** How far below eye level, metres: reading is easier looking slightly down. */
export const PANEL_DROP = 0.2;
/** A following panel waits until the heading has wandered this far off it. */
export const FOLLOW_THRESHOLD = (35 * Math.PI) / 180;
/** …then catches up with this time constant, seconds… */
const FOLLOW_TIME = 0.3;
/** …until it is back within this. */
const FOLLOW_SETTLED = (2 * Math.PI) / 180;

/**
 * The wrist panel's pose in the left controller's grip space: above the
 * hand, tipped back toward the eyes, and smaller, since it is read at half an
 * arm's length.
 */
export const WRIST = {
  position: [0, 0.09, 0.02] as const,
  tilt: (-40 * Math.PI) / 180,
  scale: 0.55,
};

export interface Pose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface FollowState {
  heading: number;
  catchingUp: boolean;
}

const forward = new Vec3();
const euler = new Euler(0, 0, 0, 'YXZ');

/** An angle wrapped into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.floor((angle + Math.PI) / turn);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * The head's heading: its yaw about the vertical, 0 looking down -z. Looking
 * nearly straight up or down leaves no horizontal direction to read, so the
 * previous heading is kept rather than letting the panel spin.
 */
export function headingOf(head: Quaternion, previous = 0): number {
  forward.set(0, 0, -1).applyQuaternion(head);
  if (Math.hypot(forward.x, forward.z) < 0.15) {
    return previous;
  }
  return Math.atan2(-forward.x, -forward.z);
}

/**
 * A panel `PANEL_DISTANCE` in front of `eye` along `heading` and `PANEL_DROP`
 * below it, turned to face the eye and leaned back so it is square to the line
 * of sight.
 */
export function poseAt(eye: Vector3, heading: number, out: Pose): Pose {
  out.position.set(
    eye.x - Math.sin(heading) * PANEL_DISTANCE,
    eye.y - PANEL_DROP,
    eye.z - Math.cos(heading) * PANEL_DISTANCE,
  );
  out.quaternion.setFromEuler(euler.set(-Math.atan2(PANEL_DROP, PANEL_DISTANCE), heading, 0));
  return out;
}

/** Advance a following panel's heading toward the head's by one frame of `dt` seconds. */
export function stepFollow(state: FollowState, headHeading: number, dt: number): void {
  const offset = wrapAngle(headHeading - state.heading);
  if (Math.abs(offset) > FOLLOW_THRESHOLD) {
    state.catchingUp = true;
  }
  if (!state.catchingUp) {
    return;
  }
  state.heading = wrapAngle(state.heading + offset * (1 - Math.exp(-dt / FOLLOW_TIME)));
  if (Math.abs(wrapAngle(headHeading - state.heading)) < FOLLOW_SETTLED) {
    state.catchingUp = false;
  }
}
