/**
 * Holds the VR panel in its current placement (see placement.ts): hung off
 * the left controller's grip for `wrist`, or put in the room frame in front of
 * the viewer for `follow` and `pinned`.
 */

import type { XrOverlay } from '../../render/scene/xr-overlay.ts';
import type { FollowState, Placement, Pose } from './placement.ts';
import type { Object3D } from 'three';
import { Group, Quaternion, Vector3 } from 'three';
import { headingOf, PLACEMENTS, poseAt, stepFollow, WRIST } from './placement.ts';

export class PanelMount {
  private readonly holder = new Group();
  private current: Placement = PLACEMENTS[0];
  /** False until the panel has been put down for the current placement. */
  private placed = false;
  private readonly follow: FollowState = { heading: 0, catchingUp: false };
  private readonly pose: Pose = { position: new Vector3(), quaternion: new Quaternion() };

  constructor(
    private readonly overlay: XrOverlay,
    content: Object3D,
  ) {
    this.holder.add(content);
    overlay.dolly.add(this.holder);
  }

  get placement(): Placement {
    return this.current;
  }

  set placement(placement: Placement) {
    this.current = placement;
    this.placed = false;
  }

  get visible(): boolean {
    return this.holder.visible;
  }

  set visible(visible: boolean) {
    this.holder.visible = visible;
  }

  /** Put the panel down in front of the viewer again on the next frame. */
  resummon(): void {
    this.placed = false;
  }

  /** One frame of placement, `dt` seconds after the last. */
  place(dt: number): void {
    const grip = this.current === 'wrist' ? this.overlay.grip('left') : null;
    if (grip) {
      if (this.holder.parent !== grip) {
        grip.add(this.holder);
        this.holder.position.set(...WRIST.position);
        this.holder.rotation.set(WRIST.tilt, 0, 0);
        this.holder.scale.setScalar(WRIST.scale);
      }
      return;
    }
    // Following and pinned panels live in the room frame. A wrist panel with
    // no left controller to hold it follows until one connects.
    if (this.holder.parent !== this.overlay.dolly) {
      this.overlay.dolly.add(this.holder);
      this.holder.scale.setScalar(1);
      this.placed = false;
    }
    const head = this.overlay.head;
    const heading = headingOf(head.quaternion, this.follow.heading);
    if (!this.placed) {
      this.follow.heading = heading;
      this.follow.catchingUp = false;
    } else if (this.current === 'pinned') {
      return;
    } else {
      stepFollow(this.follow, heading, dt);
    }
    this.placed = true;
    poseAt(head.position, this.follow.heading, this.pose);
    this.holder.position.copy(this.pose.position);
    this.holder.quaternion.copy(this.pose.quaternion);
  }
}
