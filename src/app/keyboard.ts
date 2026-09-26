/** The keyboard: routing key events to the camera's hold-to-move keys and to the shortcuts. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';
import type { HelpOverlay } from '../ui/panels/help-overlay.ts';
import type { Toast } from '../ui/panels/toast.ts';
import type { KeyTarget } from './key-routing.ts';
import {
  MOVEMENT_KEYS,
  pressCameraKey,
  releaseAllCameraKeys,
  releaseCameraKey,
} from './camera-keys.ts';
import { appHandlesKey, shortcutRepeats } from './key-routing.ts';
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

/** Describe where a key event landed, for the routing rules. */
function keyTarget(target: EventTarget | null): KeyTarget {
  // Anything that is not an HTML element — the window, the document, an SVG
  // node — cannot hold a caret or keyboard focus of its own.
  if (!(target instanceof HTMLElement)) {
    return 'page';
  }
  if (target instanceof HTMLInputElement) {
    return target.type === 'range' ? 'slider' : 'text';
  }
  if (target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return 'text';
  }
  const page =
    target === document.body ||
    target === document.documentElement ||
    target instanceof HTMLCanvasElement;
  return page ? 'page' : 'control';
}

/** Route one key press to the camera keys or a shortcut, or leave it to the page. */
function onKeyDown(ev: KeyboardEvent, deps: KeyboardDeps): void {
  const press = {
    key: ev.key,
    ctrlKey: ev.ctrlKey,
    metaKey: ev.metaKey,
    altGraph: ev.getModifierState('AltGraph'),
  };
  if (!appHandlesKey(press, keyTarget(ev.target))) {
    return;
  }

  // Any movement key takes the controls back mid-flight, the same way a drag
  // does. Selection and display keys are left alone so pressing `M` during an
  // approach does not abort it.
  if (MOVEMENT_KEYS.has(ev.code)) {
    deps.camera.cancelFlight();
  }

  if (pressCameraKey(ev, deps.camera.keys)) {
    return;
  }

  // Single-shot actions. Holding one of these would otherwise run it again
  // at the key-repeat rate, flickering a toggle on and off.
  if (ev.repeat && !shortcutRepeats(ev.key)) {
    return;
  }
  runShortcut(ev, deps);
}

/** Wire the key handlers to the window. */
export function installKeyboard(deps: KeyboardDeps): void {
  const { camera } = deps;

  window.addEventListener('keydown', (ev) => {
    onKeyDown(ev, deps);
  });

  window.addEventListener('keyup', (ev) => {
    // macOS sends no key-up for a letter released while Cmd is held, so a
    // Cmd chord with a movement key would leave that key flying the camera.
    if (ev.key === 'Meta') {
      releaseAllCameraKeys(camera);
      return;
    }
    releaseCameraKey(ev, camera.keys);
  });

  // Releasing focus should not leave a key stuck down.
  window.addEventListener('blur', () => {
    releaseAllCameraKeys(camera);
  });

  // The wheel sets the speed WASD flies at, which would otherwise be invisible
  // until the next key press. Announced here, beside the keys it affects.
  camera.onFreeSpeedChange = (factor): void => {
    deps.toast.show(`Flight speed ×${factor.toPrecision(2)}`);
  };
}
