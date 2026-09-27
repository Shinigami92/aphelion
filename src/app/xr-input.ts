/**
 * VR controller input: the sticks steer, the trigger picks or presses, the
 * face buttons toggle.
 *
 * Read from the xr-standard gamepad layout that current headsets' controllers
 * all report:
 *
 *   trigger, either hand    press what the ray points at on the VR panel,
 *                           or select the body it points at and fly there
 *   left stick              zoom in and out (fly, in free mode)
 *   right stick             orbit round the focus (turn and look, in free mode)
 *   A                       pause / resume the clock
 *   B                       diorama / true scale
 *   right stick, clicked    orbit / free flight
 *   left stick, clicked     show / hide the VR panel
 *   left d-pad down         the panel on the wrist
 *   left d-pad, other ways  the panel following / pinned in the room
 *
 * The clock and camera toggles are on the right hand because that is the only
 * place three buttons can be told apart. xr-standard has two face buttons per controller, and a
 * runtime folds whatever a controller really has into them. Measured on a Steam
 * Frame, which Chrome is handed as an Oculus Touch: the right hand's A is the
 * first slot and B, X and Y all arrive as the second, while the left hand has
 * a d-pad, down in the first slot and the other three directions in the
 * second. A binding on the left hand's first button — X, on a Touch — landed
 * on d-pad down. So the d-pad offers two placements rather than three: down is
 * the wrist, and left, right and up — one button to the browser — switch
 * between following and pinned.
 *
 * A pinch with a tracked hand arrives as a select too, so hands can pick
 * without controllers.
 */

import type { CameraController } from '../controls/camera.ts';
import type { Stick } from '../controls/camera/stick.ts';
import type { Toast } from '../ui/panels/toast.ts';
import type { VrUi, VrUiDeps } from '../ui/xr/index.ts';
import { Quaternion } from 'three';
import { deadZone } from '../controls/camera/stick.ts';
import { RAY_PICK_TOLERANCE } from '../render/scene/xr-rig.ts';

/** What the controllers act on: what the VR panel does, and the page's toasts. */
export interface XrInputDeps extends VrUiDeps {
  camera: CameraController;
  toast: Toast;
}

// xr-standard gamepad layout: the thumbstick's axes, its click, and the two
// face buttons.
const STICK_X = 2;
const STICK_Y = 3;
const STICK_CLICK = 3;
const BUTTON_LOWER = 4; // A on the right hand
const BUTTON_UPPER = 5; // B on the right hand

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
  /** The VR panel, once its module has loaded on the first session. */
  private ui: VrUi | null = null;
  private uiRequested = false;

  constructor(private readonly deps: XrInputDeps) {
    deps.scene.xr.controllers.forEach((controller, index) => {
      controller.addEventListener('select', () => {
        // A pull that started on the panel pressed something there.
        if (this.ui?.owns(index) !== true) {
          this.pick(index);
        }
      });
    });
  }

  /**
   * Load the VR panel the first time a session runs. The UI library and its
   * fonts are a download of their own, which nobody without a headset needs.
   */
  private async loadUi(): Promise<void> {
    this.uiRequested = true;
    const { VrUi } = await import('../ui/xr/index.ts');
    this.ui = new VrUi(this.deps);
  }

  /** Read the sticks and buttons for one frame of `dt` seconds. */
  update(dt: number): void {
    const { scene, camera } = this.deps;
    const session = scene.xr.session;
    if (!scene.xr.presenting || !session) {
      return;
    }
    if (!this.uiRequested) {
      void this.loadUi();
    }
    let left = CENTRED;
    let right: Stick = CENTRED;
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
    if (this.ui?.scroll(right, dt) === true) {
      right = CENTRED;
    }
    camera.steer({ left, right }, scene.xr.head.getWorldQuaternion(this.heading), dt);
    this.ui?.update(dt);
  }

  private readButtons(source: XRInputSource, pad: Gamepad): void {
    const hand = source.handedness;
    if (hand !== 'left' && hand !== 'right') {
      return;
    }
    const before = this.held.get(source) ?? [];
    const now = pad.buttons.map((button) => button.pressed);
    const watched = [STICK_CLICK, BUTTON_LOWER, BUTTON_UPPER];
    for (const index of watched) {
      if (now[index] && !before[index]) {
        this.press(hand, index);
      }
    }
    this.held.set(source, now);
  }

  /** Act on a button going down. */
  private press(hand: 'left' | 'right', button: number): void {
    const { time, scene, camera } = this.deps;
    if (hand === 'left') {
      this.pressLeft(button);
    } else if (button === BUTTON_LOWER) {
      time.togglePause();
      this.notify(time.paused ? 'Paused' : `Running — ${time.rateLabel}`);
    } else if (button === BUTTON_UPPER) {
      scene.xr.scale = scene.xr.scale === 'diorama' ? 'true' : 'diorama';
      this.notify(scene.xr.scale === 'true' ? 'VR: true scale, 1 m = 1 m' : 'VR: diorama scale');
    } else {
      this.notify(camera.toggleMode() === 'free' ? 'Free flight' : 'Orbit');
    }
  }

  /** The left hand's buttons all place the VR panel. */
  private pressLeft(button: number): void {
    const ui = this.ui;
    if (!ui) {
      return;
    }
    if (button === STICK_CLICK) {
      ui.toggle();
    } else if (button === BUTTON_LOWER) {
      ui.showAt('wrist');
      this.notify('Panel on the wrist');
    } else {
      this.notify(ui.switchRoomPlacement() === 'follow' ? 'Panel follows you' : 'Panel pinned');
    }
  }

  /** Tell both the page and the headset. */
  private notify(message: string): void {
    this.deps.toast.show(message);
    this.ui?.say(message);
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
