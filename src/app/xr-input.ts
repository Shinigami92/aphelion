/**
 * VR controller input: the sticks steer, the trigger picks, the face buttons toggle.
 *
 * Read from the xr-standard gamepad layout that current headsets' controllers
 * all report:
 *
 *   trigger, either hand    select what the ray points at and fly there
 *   left stick              orbit round the focus (fly, in free mode)
 *   right stick             zoom (turn and climb, in free mode)
 *   A, right hand           pause / resume the clock
 *   B, right hand           diorama / true scale
 *   X, left hand            orbit / free flight
 *
 * A pinch with a tracked hand arrives as a select too, so hands can pick
 * without controllers.
 */

import type { CameraController } from '../controls/camera.ts';
import type { Stick } from '../controls/camera/stick.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';
import type { Toast } from '../ui/panels/toast.ts';
import { Quaternion } from 'three';
import { deadZone } from '../controls/camera/stick.ts';
import { RAY_PICK_TOLERANCE } from '../render/scene/xr-rig.ts';

/** What the controllers act on. */
export interface XrInputDeps {
  time: TimeController;
  system: SolarSystem;
  scene: SceneView;
  camera: CameraController;
  toast: Toast;
  select: (body: SimBody) => void;
  goTo: (body: SimBody) => void;
}

// xr-standard gamepad layout: the thumbstick's axes and the two face buttons.
const STICK_X = 2;
const STICK_Y = 3;
const BUTTON_LOWER = 4; // A on the right hand, X on the left
const BUTTON_UPPER = 5; // B on the right hand, Y on the left

const CENTRED: Stick = { x: 0, y: 0 };

/** A controller's thumbstick, dead zone removed, with +y pushed forward. */
function stickOf(pad: Gamepad): Stick {
  // The gamepad reports forward as -1, the way a screen counts rows.
  return { x: deadZone(pad.axes[STICK_X] ?? 0), y: -deadZone(pad.axes[STICK_Y] ?? 0) };
}

export class XrInput {
  /** Which buttons each controller held last frame, so a press acts once. */
  private readonly held = new WeakMap<XRInputSource, boolean[]>();
  private readonly heading = new Quaternion();

  constructor(private readonly deps: XrInputDeps) {
    deps.scene.xr.controllers.forEach((controller, index) => {
      controller.addEventListener('select', () => {
        this.pick(index);
      });
    });
  }

  /** Read the sticks and buttons for one frame of `dt` seconds. */
  update(dt: number): void {
    const { scene, camera } = this.deps;
    const session = scene.xr.session;
    if (!scene.xr.presenting || !session) {
      return;
    }
    let left = CENTRED;
    let right = CENTRED;
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      if (!pad) {
        continue;
      }
      if (source.handedness === 'left') {
        left = stickOf(pad);
      } else if (source.handedness === 'right') {
        right = stickOf(pad);
      }
      this.readButtons(source, pad);
    }
    camera.steer({ left, right }, scene.xr.head.getWorldQuaternion(this.heading), dt);
  }

  private readButtons(source: XRInputSource, pad: Gamepad): void {
    const before = this.held.get(source) ?? [];
    const now = pad.buttons.map((button) => button.pressed);
    for (const index of [BUTTON_LOWER, BUTTON_UPPER]) {
      if (now[index] && !before[index]) {
        this.press(source.handedness, index);
      }
    }
    this.held.set(source, now);
  }

  private press(hand: XRHandedness, button: number): void {
    const { time, scene, camera, toast } = this.deps;
    if (hand === 'right' && button === BUTTON_LOWER) {
      time.togglePause();
      toast.show(time.paused ? 'Paused' : `Running — ${time.rateLabel}`);
    } else if (hand === 'right' && button === BUTTON_UPPER) {
      scene.xr.scale = scene.xr.scale === 'diorama' ? 'true' : 'diorama';
      toast.show(scene.xr.scale === 'true' ? 'VR: true scale, 1 m = 1 m' : 'VR: diorama scale');
    } else if (hand === 'left' && button === BUTTON_LOWER) {
      toast.show(camera.toggleMode() === 'free' ? 'Free flight' : 'Orbit');
    }
  }

  /** Select whatever controller `index` points at, and fly there. */
  private pick(index: number): void {
    const { scene, system, select, goTo } = this.deps;
    const view = scene.xr.rayView(index);
    if (!view) {
      return;
    }
    const centre = view.viewport.clone().multiplyScalar(0.5);
    const body = scene.pick(centre.x, centre.y, system, RAY_PICK_TOLERANCE, view);
    if (body) {
      select(body);
      goTo(body);
    }
  }
}
