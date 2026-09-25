/** The hold-to-move keys: which key drives which part of the camera. */

import type { CameraController, CameraKeyState } from '../controls/camera.ts';

/** Keys that mean "I am driving now", which cancels a cinematic approach. */
export const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
]);

/**
 * Hold-to-move keys: set the camera key state on key down.
 *
 * Returns true when the key was a movement key, which ends its handling.
 */
export function pressCameraKey(ev: KeyboardEvent, keys: CameraKeyState): boolean {
  switch (ev.code) {
    case 'KeyW':
      keys.forward = true;
      return true;
    case 'KeyS':
      keys.back = true;
      return true;
    case 'KeyA':
      keys.left = true;
      return true;
    case 'KeyD':
      keys.right = true;
      return true;
    case 'KeyR':
      keys.up = true;
      return true;
    case 'KeyF':
      keys.down = true;
      return true;
    case 'KeyQ':
      keys.rollLeft = true;
      return true;
    case 'KeyE':
      keys.rollRight = true;
      return true;
    case 'ArrowLeft':
      keys.orbitLeft = true;
      ev.preventDefault();
      return true;
    case 'ArrowRight':
      keys.orbitRight = true;
      ev.preventDefault();
      return true;
    case 'ArrowUp':
      keys.orbitUp = true;
      ev.preventDefault();
      return true;
    case 'ArrowDown':
      keys.orbitDown = true;
      ev.preventDefault();
      return true;
    case 'Equal':
    case 'NumpadAdd':
      keys.zoomIn = true;
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      keys.zoomOut = true;
      return true;
    default:
      break;
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
  switch (ev.code) {
    case 'KeyW':
      keys.forward = false;
      break;
    case 'KeyS':
      keys.back = false;
      break;
    case 'KeyA':
      keys.left = false;
      break;
    case 'KeyD':
      keys.right = false;
      break;
    case 'KeyR':
      keys.up = false;
      break;
    case 'KeyF':
      keys.down = false;
      break;
    case 'KeyQ':
      keys.rollLeft = false;
      break;
    case 'KeyE':
      keys.rollRight = false;
      break;
    case 'ArrowLeft':
      keys.orbitLeft = false;
      break;
    case 'ArrowRight':
      keys.orbitRight = false;
      break;
    case 'ArrowUp':
      keys.orbitUp = false;
      break;
    case 'ArrowDown':
      keys.orbitDown = false;
      break;
    case 'Equal':
    case 'NumpadAdd':
      keys.zoomIn = false;
      break;
    case 'Minus':
    case 'NumpadSubtract':
      keys.zoomOut = false;
      break;
    default:
      break;
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
  camera.keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    precise: false,
    orbitLeft: false,
    orbitRight: false,
    orbitUp: false,
    orbitDown: false,
    zoomIn: false,
    zoomOut: false,
  };
}
