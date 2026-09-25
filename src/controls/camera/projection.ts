/** Near and far clip planes, chosen afresh every frame. */

import type { CameraState } from './state.ts';

/**
 * Near and far planes derived from how much empty space is actually ahead.
 *
 * The scene spans eleven orders of magnitude, so fixed planes cannot work. We
 * pick a window around the camera each frame; combined with the logarithmic
 * depth buffer this keeps a spacecraft-scale foreground and a Neptune-scale
 * background in the same image without z-fighting.
 *
 * The window must come from the nearest *surface*, not from `distance`.
 * `distance` is measured to the focused body, which in orbit mode is the thing
 * you are looking at and in free flight is emphatically not: parked 102 units
 * off Mars with Earth still focused, `distance` reads 285,359, which put the
 * near plane at 2,852 — 28 times further away than the planet in front of the
 * camera. Mars fell entirely inside the near plane and was clipped out of
 * existence, and its label went with it, since projecting a point inside the
 * near plane culls it too. Flying between planets simply erased the
 * destination.
 *
 * Taking the smaller of the two references fixes that without disturbing
 * orbit mode, where the focus normally *is* the nearest surface and the two
 * agree. The clearance can also be negative, when the camera is inside a
 * body; the floor handles that, and a tiny near plane is what you want there
 * anyway so you can see back out.
 */
export function updateProjection(s: CameraState): void {
  const toFocusSurface = s.focus ? Math.max(s.distance - s.focus.sceneRadius, 1e-5) : s.distance;
  const clearance = Number.isFinite(s.nearestSurface) ? s.nearestSurface : toFocusSurface;
  const room = Math.max(Math.min(toFocusSurface, clearance), 1e-5);

  const near = Math.max(1e-5, Math.min(room * 0.02, s.distance * 0.01));
  const far = Math.max(near * 1e6, s.distance * 4e4 + 1e6);
  if (s.camera.near !== near || s.camera.far !== far) {
    s.camera.near = near;
    s.camera.far = far;
    s.camera.updateProjectionMatrix();
  }
}
