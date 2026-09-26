/** The keyboard: routing key events to the camera's hold-to-move keys and to the shortcuts. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';
import type { HelpOverlay } from '../ui/panels/help-overlay.ts';
import type { Toast } from '../ui/panels/toast.ts';
import {
  MOVEMENT_KEYS,
  pressCameraKey,
  releaseAllCameraKeys,
  releaseCameraKey,
} from './camera-keys.ts';
import { runShortcut } from './shortcuts.ts';

/** Everything the shortcuts act on. */
export interface KeyboardDeps {
  time: TimeController;
  scale: ScaleModel;
  system: SolarSystem;
  scene: SceneView;
  camera: CameraController;
  toast: Toast;
  help: HelpOverlay;
  focused: () => SimBody;
  selected: () => SimBody;
  select: (body: SimBody) => void;
  goTo: (body: SimBody) => void;
  setLagrange: (on: boolean) => void;
  refreshViewOptions: () => void;
  focusSearch: () => void;
}

function typingInField(target: EventTarget | null): boolean {
  // Anything that is not an HTML element — the window, the document, an SVG
  // node — has neither a form-field tag nor `isContentEditable`.
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const node = target;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable;
}

/** Wire the key handlers to the window. */
export function installKeyboard(deps: KeyboardDeps): void {
  const { camera } = deps;

  window.addEventListener('keydown', (ev) => {
    if (typingInField(ev.target)) {
      return;
    }

    // Any movement key takes the controls back mid-flight, the same way a drag
    // does. Selection and display keys are left alone so pressing `M` during an
    // approach does not abort it.
    if (MOVEMENT_KEYS.has(ev.code)) {
      camera.cancelFlight();
    }

    if (pressCameraKey(ev, camera.keys)) {
      return;
    }

    // Single-shot actions.
    runShortcut(ev, deps);
  });

  window.addEventListener('keyup', (ev) => {
    releaseCameraKey(ev, camera.keys);
  });

  // Releasing focus should not leave a key stuck down.
  window.addEventListener('blur', () => {
    releaseAllCameraKeys(camera);
  });
}
