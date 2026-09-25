/** The single-shot keyboard shortcuts, and the key handlers that route to them. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';
import type { LabelMode, OrbitMode, Quality } from '../render/scene/types.ts';
import type { HelpOverlay } from '../ui/panels/help-overlay.ts';
import type { Toast } from '../ui/panels/toast.ts';
import { AU_KM, SCENE_UNIT_KM } from '../core/constants.ts';
import {
  MOVEMENT_KEYS,
  pressCameraKey,
  releaseAllCameraKeys,
  releaseCameraKey,
} from './camera-keys.ts';
import { PLANET_ORDER } from './navigation.ts';

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

const ORBIT_MODES: OrbitMode[] = ['none', 'planets', 'all'];
const LABEL_MODES: LabelMode[] = ['none', 'major', 'all'];
const QUALITIES: Quality[] = ['low', 'medium', 'high'];
let quality: Quality = 'high';

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

/** Frame the entire solar system from above. */
function frameEverything(deps: KeyboardDeps): void {
  const { camera, system, toast } = deps;
  camera.setFocus(system.sun, { immediate: false });
  // Neptune's remapped orbit sets the useful extent.
  const neptune = system.byKey.get('neptune');
  const extent = neptune
    ? Math.hypot(neptune.scene.x, neptune.scene.y, neptune.scene.z)
    : (AU_KM * 30) / SCENE_UNIT_KM;
  camera.frameSystem(system.sun, extent);
  toast.show('Whole system');
}

function cyclePlanet(deps: KeyboardDeps, step: number): void {
  // Walk up to the planet that owns whatever is focused — a moon's planet, or
  // the planet a Lagrange point belongs to. Without the second case, tabbing
  // away from L4 restarted at Mercury instead of continuing from its planet.
  const current = deps.focused();
  const anchor =
    current.type === 'moon' || current.type === 'lagrange'
      ? (current.parent?.key ?? 'earth')
      : current.key;
  const index = PLANET_ORDER.indexOf(anchor);
  const next = PLANET_ORDER[(index + step + PLANET_ORDER.length) % PLANET_ORDER.length];
  const body = deps.system.byKey.get(next);
  if (body) {
    deps.select(body);
    deps.goTo(body);
  }
}

/** Wire the key handlers to the window. */
export function installKeyboard(deps: KeyboardDeps): void {
  const { time, scale, system, scene, camera, toast } = deps;

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
    switch (ev.key) {
      case ' ':
        ev.preventDefault();
        time.togglePause();
        toast.show(time.paused ? 'Paused' : `Running — ${time.rateLabel}`);
        break;
      case 'j':
      case 'J':
        time.setDirection(-1);
        time.setPaused(false);
        toast.show(`Reversed — ${time.rateLabel}`);
        break;
      case 'l':
      case 'L':
        time.setDirection(1);
        time.setPaused(false);
        toast.show(`Forward — ${time.rateLabel}`);
        break;
      case ']':
        time.faster();
        toast.show(time.rateLabel);
        break;
      case '[':
        time.slower();
        toast.show(time.rateLabel);
        break;
      case '.':
        time.stepOnePreset(1);
        break;
      case ',':
        time.stepOnePreset(-1);
        break;
      case 'n':
      case 'N':
        time.setNow();
        time.resetRate();
        toast.show('Now, real-time');
        break;
      case 't':
      case 'T': {
        const mode = scale.toggle();
        deps.refreshViewOptions();
        toast.show(
          mode === 'true'
            ? 'True scale — 1:1, and mostly empty'
            : 'Explore scale — bodies enlarged, distances compressed',
        );
        break;
      }
      case 'o':
      case 'O': {
        const next =
          ORBIT_MODES[(ORBIT_MODES.indexOf(scene.toggles.orbits) + 1) % ORBIT_MODES.length];
        scene.toggles.orbits = next;
        deps.refreshViewOptions();
        toast.show(`Orbits: ${next}`);
        break;
      }
      case 'm':
      case 'M': {
        const next =
          LABEL_MODES[(LABEL_MODES.indexOf(scene.toggles.labels) + 1) % LABEL_MODES.length];
        scene.toggles.labels = next;
        deps.refreshViewOptions();
        toast.show(`Labels: ${next}`);
        break;
      }
      case 'b':
      case 'B':
        scene.toggles.belts = !scene.toggles.belts;
        deps.refreshViewOptions();
        toast.show(`Belts ${scene.toggles.belts ? 'on' : 'off'}`);
        break;
      case 'k':
      case 'K':
        scene.toggles.rings = !scene.toggles.rings;
        deps.refreshViewOptions();
        toast.show(`Rings ${scene.toggles.rings ? 'on' : 'off'}`);
        break;
      case 'i':
      case 'I':
        scene.toggles.atmospheres = !scene.toggles.atmospheres;
        deps.refreshViewOptions();
        toast.show(`Atmospheres ${scene.toggles.atmospheres ? 'on' : 'off'}`);
        break;
      case 'x':
      case 'X':
        deps.setLagrange(!scene.toggles.lagrange);
        deps.refreshViewOptions();
        toast.show(`Lagrange points ${scene.toggles.lagrange ? 'on' : 'off'}`);
        break;
      case 'p':
      case 'P':
        quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!;
        scene.setQuality(quality);
        toast.show(`Quality: ${quality}`);
        break;
      case 'v':
      case 'V': {
        const mode = camera.toggleMode();
        // Only reachable from a keyboard in the first place, so naming keys here
        // is safe — but it is the sort of message to re-read if free flight ever
        // gets a touch affordance.
        toast.show(mode === 'free' ? 'Free flight — WASD to fly, V to return' : 'Orbit camera');
        break;
      }
      case 'c':
      case 'C':
        camera.lookAtFocus();
        break;
      case 'g':
      case 'G':
        deps.goTo(deps.selected());
        break;
      case '/':
        ev.preventDefault();
        deps.focusSearch();
        break;
      case 'h':
      case 'H':
      case '?':
        deps.help.toggle();
        break;
      case 'Escape':
        deps.help.hide();
        break;
      case 'Home':
        frameEverything(deps);
        break;
      case 'Tab':
        ev.preventDefault();
        cyclePlanet(deps, ev.shiftKey ? -1 : 1);
        break;
      case '0':
        deps.select(system.sun);
        deps.goTo(system.sun);
        break;
      default:
        if (/^[1-9]$/u.test(ev.key)) {
          const key = PLANET_ORDER[Number(ev.key) - 1];
          const body = key ? system.byKey.get(key) : undefined;
          if (body) {
            deps.select(body);
            deps.goTo(body);
          }
        }
        break;
    }
  });

  window.addEventListener('keyup', (ev) => {
    releaseCameraKey(ev, camera.keys);
  });

  // Releasing focus should not leave a key stuck down.
  window.addEventListener('blur', () => {
    releaseAllCameraKeys(camera);
  });
}
