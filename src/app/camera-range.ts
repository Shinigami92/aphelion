/** How far the camera is from the body it orbits, in terms a person can read. */

import type { CameraController } from '../controls/camera.ts';
import type { SimBody } from '../core/system.ts';

/**
 * Convert the camera's distance out of scene space into something physical.
 *
 * The raw scene distance is only kilometres in true-scale mode. Explore mode
 * enlarges bodies and compresses the space between them, so reporting scene
 * units as kilometres was simply wrong there — at one point the readout claimed
 * "5.6 AU" for a viewpoint that was nothing of the sort.
 *
 * Distance in *radii of the focused body* is exact in both modes, because a body
 * and its immediate surroundings scale uniformly. Multiplying back by the body's
 * true radius therefore gives an honest distance: the range at which the body
 * would appear this size at 1:1. In true-scale mode it reduces to the real
 * distance exactly.
 */
export class CameraRange {
  /** Camera distance from the focused body, in true kilometres. */
  km = 0;
  /** The same distance expressed in radii of the focused body. */
  radii = 0;

  constructor(
    private readonly camera: CameraController,
    private readonly focused: () => SimBody,
  ) {}

  update(): void {
    const body = this.focused();
    const radius = body.sceneRadius;
    this.radii = radius > 0 ? this.camera.currentDistance / radius : 0;
    this.km = this.radii * body.radiusKm;
  }
}
