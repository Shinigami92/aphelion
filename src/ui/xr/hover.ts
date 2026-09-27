/**
 * What the right controller's ray is pointing at in the solar system, so its
 * label can show before the trigger is pulled. The same picker as a pull
 * (`rayView` + `scene.pick`), a few times a second: aiming is slow, and a
 * pick walks every body.
 */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { SceneView } from '../../render/scene.ts';
import { RAY_PICK_TOLERANCE } from '../../render/scene/xr-rig.ts';

/** How often the hover is re-picked, milliseconds. */
const HOVER_MS = 100;

export class RayHover {
  body: SimBody | null = null;
  private at = -Infinity;

  constructor(
    private readonly scene: SceneView,
    private readonly system: SolarSystem,
  ) {}

  /** The controller slot held in the right hand, or -1. */
  get index(): number {
    return this.scene.xr.overlay.handedness.indexOf('right');
  }

  /** Re-pick, unless it is too soon; `blocked` while the ray is on the panel. */
  update(now: number, blocked: boolean): void {
    if (now - this.at < HOVER_MS) {
      return;
    }
    this.at = now;
    const index = this.index;
    const view = index === -1 || blocked ? null : this.scene.xr.rayView(index);
    if (!view) {
      this.body = null;
      return;
    }
    const centre = view.viewport.x / 2;
    this.body = this.scene.pick(centre, view.viewport.y / 2, this.system, RAY_PICK_TOLERANCE, view);
  }
}
