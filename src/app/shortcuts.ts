/** The single-shot keyboard shortcuts: one key, one action, grouped by what they act on. */

import type { LabelMode, OrbitMode, Quality } from '../render/scene/types.ts';
import type { KeyboardDeps } from './keyboard.ts';
import { AU_KM, SCENE_UNIT_KM } from '../core/constants.ts';
import { PLANET_ORDER } from './navigation.ts';

const ORBIT_MODES: OrbitMode[] = ['none', 'planets', 'all'];
const LABEL_MODES: LabelMode[] = ['none', 'major', 'all'];
const QUALITIES: Quality[] = ['low', 'medium', 'high'];
let quality: Quality = 'high';

/** Clock keys: pause, direction, rate and stepping. */
function timeShortcut(ev: KeyboardEvent, deps: KeyboardDeps): boolean {
  const { time, toast } = deps;
  switch (ev.key) {
    case ' ':
      ev.preventDefault();
      time.togglePause();
      toast.show(time.paused ? 'Paused' : `Running — ${time.rateLabel}`);
      return true;
    case 'j':
    case 'J':
      time.setDirection(-1);
      time.setPaused(false);
      toast.show(`Reversed — ${time.rateLabel}`);
      return true;
    case 'l':
    case 'L':
      time.setDirection(1);
      time.setPaused(false);
      toast.show(`Forward — ${time.rateLabel}`);
      return true;
    case ']':
      time.faster();
      toast.show(time.rateLabel);
      return true;
    case '[':
      time.slower();
      toast.show(time.rateLabel);
      return true;
    case '.':
      time.stepOnePreset(1);
      return true;
    case ',':
      time.stepOnePreset(-1);
      return true;
    case 'n':
    case 'N':
      time.setNow();
      time.resetRate();
      toast.show('Now, real-time');
      return true;
    default:
      return false;
  }
}

/** Keys that switch between modes: scale, orbits, labels and camera. */
function modeShortcut(ev: KeyboardEvent, deps: KeyboardDeps): boolean {
  const { scale, scene, camera, toast } = deps;
  switch (ev.key) {
    case 't':
    case 'T': {
      const mode = scale.toggle();
      deps.refreshViewOptions();
      toast.show(
        mode === 'true'
          ? 'True scale — 1:1, and mostly empty'
          : 'Explore scale — bodies enlarged, distances compressed',
      );
      return true;
    }
    case 'o':
    case 'O': {
      const next =
        ORBIT_MODES[(ORBIT_MODES.indexOf(scene.toggles.orbits) + 1) % ORBIT_MODES.length];
      scene.toggles.orbits = next;
      deps.refreshViewOptions();
      toast.show(`Orbits: ${next}`);
      return true;
    }
    case 'm':
    case 'M': {
      const next =
        LABEL_MODES[(LABEL_MODES.indexOf(scene.toggles.labels) + 1) % LABEL_MODES.length];
      scene.toggles.labels = next;
      deps.refreshViewOptions();
      toast.show(`Labels: ${next}`);
      return true;
    }
    case 'v':
    case 'V': {
      const mode = camera.toggleMode();
      // Only reachable from a keyboard in the first place, so naming keys here
      // is safe — but it is the sort of message to re-read if free flight ever
      // gets a touch affordance.
      toast.show(
        mode === 'free'
          ? 'Free flight — WASD to fly, wheel for speed, V to return'
          : 'Orbit camera',
      );
      return true;
    }
    default:
      return false;
  }
}

/** Keys that switch a drawn layer on or off, and the quality preset. */
function layerShortcut(ev: KeyboardEvent, deps: KeyboardDeps): boolean {
  const { scene, toast } = deps;
  switch (ev.key) {
    case 'b':
    case 'B':
      scene.toggles.belts = !scene.toggles.belts;
      deps.refreshViewOptions();
      toast.show(`Belts ${scene.toggles.belts ? 'on' : 'off'}`);
      return true;
    case 'k':
    case 'K':
      scene.toggles.rings = !scene.toggles.rings;
      deps.refreshViewOptions();
      toast.show(`Rings ${scene.toggles.rings ? 'on' : 'off'}`);
      return true;
    case 'i':
    case 'I':
      scene.toggles.atmospheres = !scene.toggles.atmospheres;
      deps.refreshViewOptions();
      toast.show(`Atmospheres ${scene.toggles.atmospheres ? 'on' : 'off'}`);
      return true;
    case 'x':
    case 'X':
      deps.setLagrange(!scene.toggles.lagrange);
      deps.refreshViewOptions();
      toast.show(`Lagrange points ${scene.toggles.lagrange ? 'on' : 'off'}`);
      return true;
    case 'p':
    case 'P':
      quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!;
      scene.setQuality(quality);
      toast.show(`Quality: ${quality}`);
      return true;
    default:
      return false;
  }
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

/** Keys that move the selection or the camera somewhere, and the overlay keys. */
function navigationShortcut(ev: KeyboardEvent, deps: KeyboardDeps): void {
  const { system, camera } = deps;
  switch (ev.key) {
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
}

/** Run the shortcut bound to this key, if there is one. */
export function runShortcut(ev: KeyboardEvent, deps: KeyboardDeps): void {
  if (timeShortcut(ev, deps) || modeShortcut(ev, deps) || layerShortcut(ev, deps)) {
    return;
  }
  navigationShortcut(ev, deps);
}
