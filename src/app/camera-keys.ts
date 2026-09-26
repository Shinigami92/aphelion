/** The hold-to-move keys: which key drives which part of the camera. */

import type { CameraController } from '../controls/camera.ts';
import type { CameraKeyState } from '../controls/camera/keys.ts';
import { emptyKeys } from '../controls/camera/keys.ts';

/**
 * Which part of the camera each physical key drives.
 *
 * One table for press and release alike, so a key can never be bound on the
 * way down and forgotten on the way up.
 */
const CAMERA_KEYS = new Map<string, keyof CameraKeyState>([
  ['KeyW', 'forward'],
  ['KeyS', 'back'],
  ['KeyA', 'left'],
  ['KeyD', 'right'],
  ['KeyR', 'up'],
  ['KeyF', 'down'],
  ['KeyQ', 'rollLeft'],
  ['KeyE', 'rollRight'],
  ['ArrowLeft', 'orbitLeft'],
  ['ArrowRight', 'orbitRight'],
  ['ArrowUp', 'orbitUp'],
  ['ArrowDown', 'orbitDown'],
  ['Equal', 'zoomIn'],
  ['NumpadAdd', 'zoomIn'],
  ['Minus', 'zoomOut'],
  ['NumpadSubtract', 'zoomOut'],
]);

/** Keys that mean "I am driving now", which cancels a cinematic approach. */
export const MOVEMENT_KEYS: ReadonlySet<string> = new Set(CAMERA_KEYS.keys());

/**
 * Hold-to-move keys: set the camera key state on key down.
 *
 * Returns true when the key was a movement key, which ends its handling.
 */
export function pressCameraKey(ev: KeyboardEvent, keys: CameraKeyState): boolean {
  const field = CAMERA_KEYS.get(ev.code);
  if (field !== undefined) {
    keys[field] = true;
    // The arrows would otherwise scroll the page as well as orbit the camera.
    if (ev.code.startsWith('Arrow')) {
      ev.preventDefault();
    }
    return true;
  }

  if (ev.key === 'Shift') {
    keys.boost = true;
  }
  if (ev.key === 'Alt') {
    keys.precise = true;
  }
  return false;
}

/** Clear a movement key on key up. */
export function releaseCameraKey(ev: KeyboardEvent, keys: CameraKeyState): void {
  const field = CAMERA_KEYS.get(ev.code);
  if (field !== undefined) {
    keys[field] = false;
  }
  if (ev.key === 'Shift') {
    keys.boost = false;
  }
  if (ev.key === 'Alt') {
    keys.precise = false;
  }
}

/** Releasing focus should not leave a key stuck down. */
export function releaseAllCameraKeys(camera: CameraController): void {
  camera.keys = emptyKeys();
}
