/** Restoring a view from a shared link, and describing a free-flight view for one. */

import type { CameraState } from './state.ts';
import { MAX_ELEVATION } from './math.ts';
import { clampDistance } from './orbit.ts';

/**
 * Restore a view decoded from a URL, without animation.
 *
 * Distance arrives in radii of the focused body rather than scene units, so a
 * shared link frames the body the same way whether the recipient lands in
 * explore or true scale. Call after the focus is set and after the system has
 * been solved once, or `sceneRadius` will still hold the previous mode's value.
 */
export function restoreView(
  s: CameraState,
  view: { azimuth?: number; elevation?: number; distanceRadii?: number },
): void {
  if (view.azimuth !== undefined && Number.isFinite(view.azimuth)) {
    s.azimuth = s.targetAzimuth = view.azimuth;
  }
  if (view.elevation !== undefined && Number.isFinite(view.elevation)) {
    const clamped = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, view.elevation));
    s.elevation = s.targetElevation = clamped;
  }
  if (view.distanceRadii !== undefined && view.distanceRadii > 0 && s.focus) {
    s.targetDistance = s.focus.sceneRadius * view.distanceRadii;
    clampDistance(s);
    s.distance = s.targetDistance;
  }
  s.mode = 'orbit';
  s.focusTransition = 1;
}

/**
 * Free-flight position and orientation, for writing into a shareable link.
 *
 * Position comes back in radii of the focused body rather than scene units,
 * so a link frames its subject the same way whichever scale mode the
 * recipient lands in — the same reasoning as `distanceInRadii`. Orientation
 * is the raw quaternion: in free flight, where you are looking is independent
 * of where you are, so there is nothing else to derive it from.
 */
export function freeView(s: CameraState): {
  position: [number, number, number];
  orientation: [number, number, number, number];
} | null {
  const radius = s.focus?.sceneRadius ?? 0;
  if (s.mode !== 'free' || radius <= 0) {
    return null;
  }
  const q = s.freeQuaternion;
  return {
    position: [s.freePosition.x / radius, s.freePosition.y / radius, s.freePosition.z / radius],
    orientation: [q.x, q.y, q.z, q.w],
  };
}

/**
 * Put the camera back into free flight exactly where a link left it.
 *
 * Called after `restoreView`, which unconditionally selects orbit mode — a
 * shared link has to be able to say "and they were flying", or reloading the
 * page swings the camera back to face the focus and throws the view away.
 */
export function restoreFreeView(
  s: CameraState,
  view: {
    position: readonly [number, number, number];
    orientation?: readonly [number, number, number, number] | null;
  },
): void {
  const radius = s.focus?.sceneRadius ?? 0;
  if (radius <= 0) {
    return;
  }
  s.freePosition.set(
    view.position[0] * radius,
    view.position[1] * radius,
    view.position[2] * radius,
  );
  if (view.orientation) {
    const [x, y, z, w] = view.orientation;
    s.freeQuaternion.set(x, y, z, w).normalize();
  }
  s.mode = 'free';
  s.camera.position.copy(s.freePosition);
  s.camera.quaternion.copy(s.freeQuaternion);
  // Keep the orbit state coherent so pressing V is not a jump.
  s.distance = Math.max(s.freePosition.length(), 1e-4);
  s.targetDistance = s.distance;
  s.focusTransition = 1;
}
