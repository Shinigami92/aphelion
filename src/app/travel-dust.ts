/** Feeding the travel dust the camera's real motion. */

import type { CameraController } from '../controls/camera.ts';
import type { SimBody } from '../core/system.ts';
import type { SceneView } from '../render/scene.ts';
import { Vector3 } from 'three';

/**
 * Feed the dust field the camera's actual velocity.
 *
 * Measured from the position delta rather than asked of the controller, because
 * only the delta accounts for every way the camera can move — a cinematic
 * flight, free flight, or a drag.
 *
 * Taken in the *render* frame, the one the camera's position is already
 * expressed in, because that is the frame the dust lattice is at rest in: the
 * streaks have to describe motion through the field that is actually drawn.
 * Measuring it in absolute scene space instead adds the focused body's own
 * orbital motion — 30 km/s at Earth — to a velocity the dust does not share,
 * which points every streak along the ecliptic on any flight slow enough for
 * that term to matter, and a hop around a small moon is exactly that slow.
 *
 * A flight switches focus the moment it starts, and the render frame moves with
 * it, so the camera's render position jumps by the gap between the two bodies on
 * that one frame. The reset drops that frame rather than reading it as a
 * velocity; nothing is lost, since a flight's intensity starts at zero anyway.
 */
export class TravelDust {
  private readonly lastCameraRender = new Vector3();
  private lastVelocityFocus: SimBody | null = null;
  private readonly cameraVelocity = new Vector3();

  constructor(
    private readonly camera: CameraController,
    private readonly scene: SceneView,
    private readonly focused: () => SimBody,
  ) {}

  update(dt: number): void {
    const here = this.camera.camera.position;
    const focus = this.focused();

    if (this.lastVelocityFocus === focus && dt > 0) {
      this.cameraVelocity.subVectors(here, this.lastCameraRender).divideScalar(dt);
    } else {
      this.cameraVelocity.set(0, 0, 0);
    }
    this.lastCameraRender.copy(here);
    this.lastVelocityFocus = focus;

    // Only a cinematic flight or genuine free flight should raise dust; drifting
    // with a body you are orbiting should not, or the field never switches off.
    const intensity =
      this.camera.travelling > 0 ? this.camera.travelling : this.freeFlightIntensity();
    this.scene.updateDust(here, this.cameraVelocity, dt, intensity);
  }

  /** How hard free flight is being driven, 0..1, for the dust. */
  private freeFlightIntensity(): number {
    if (this.camera.mode !== 'free') {
      return 0;
    }
    const k = this.camera.keys;
    const moving = k.forward || k.back || k.left || k.right || k.up || k.down;
    if (!moving) {
      return 0;
    }
    return k.boost ? 1 : 0.65;
  }
}
