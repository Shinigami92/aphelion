/** How close the camera is to the nearest surface. */

import type { CameraController } from '../controls/camera.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';

/**
 * Clearance from the camera to the nearest body's surface, in scene units.
 *
 * Free flight scales its speed by this, which is what stops it from crossing a
 * planet in a single frame. Computed here rather than in the controller because
 * this is what holds the system; 687 distance checks a frame is nothing beside
 * the solve that just ran.
 *
 * Everything is measured in the render frame, where the focused body sits at
 * the origin — the same frame the camera's position is expressed in.
 */
export function nearestSurfaceDistance(
  camera: CameraController,
  system: SolarSystem,
  focus: SimBody,
): number {
  const camPos = camera.camera.position;
  // `body.scene` is absolute; the renderer applies the floating origin by
  // shifting the whole world group, so the camera's position is relative to the
  // focus. Subtracting the focus is what puts both in the same frame — without
  // it the Sun, which sits near the absolute origin, reads as a few hundred
  // units away from a camera parked at Earth, and free flight refuses to move.
  const origin = focus.scene;
  let nearest = Infinity;
  for (const body of system.bodies) {
    const dx = body.scene.x - origin.x - camPos.x;
    const dy = body.scene.y - origin.y - camPos.y;
    const dz = body.scene.z - origin.z - camPos.z;
    const clearance = Math.hypot(dx, dy, dz) - body.sceneRadius;
    if (clearance < nearest) {
      nearest = clearance;
    }
  }
  // Reported unclamped: a negative value means the camera is inside a body, and
  // the controller needs to know that to let it fly back out rather than
  // damping it to a standstill.
  return nearest;
}
