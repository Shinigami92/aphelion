/**
 * The in-headset UI, loaded on the first VR session.
 *
 * It is a separate UI from the page's panels, not a copy of them: it reads and
 * changes the same app state — the clock, the selection, the scene's layers,
 * the camera — so either can be used, and a change made in one shows in the
 * other. Everything here is imported lazily, so a visitor without a headset
 * never downloads the UI library or its fonts.
 */

import type { CameraController } from '../../controls/camera.ts';
import type { Stick } from '../../controls/camera/stick.ts';
import type { ScaleModel } from '../../core/scale.ts';
import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { TimeController } from '../../core/time.ts';
import type { SceneView } from '../../render/scene.ts';
import type { Placement } from './placement.ts';
import { reversePainterSortStable } from '@pmndrs/uikit';
import { BodiesTab } from './bodies-tab.ts';
import { RayHover } from './hover.ts';
import { InfoTab } from './info-tab.ts';
import { VrLabels } from './labels.ts';
import { PanelMount } from './panel-mount.ts';
import { VrPanel } from './panel.ts';
import { UiPointers } from './pointers.ts';
import { createTimeTab } from './time-tab.ts';
import { createViewTab } from './view-tab.ts';

/**
 * Scrolling speed at full stick, layout pixels a second: about eleven Bodies
 * rows. The lean is squared first, so a light touch creeps for fine work and
 * only a full push hurries.
 */
const SCROLL_PX_PER_SECOND = 420;

/** What the in-headset UI acts on. */
export interface VrUiDeps {
  time: TimeController;
  system: SolarSystem;
  scene: SceneView;
  camera: CameraController;
  scale: ScaleModel;
  select: (body: SimBody) => void;
  goTo: (body: SimBody) => void;
  selected: () => SimBody;
  focused: () => SimBody;
  setLagrange: (on: boolean) => void;
  refreshViewOptions: () => void;
}

export class VrUi {
  private readonly panel: VrPanel;
  private readonly mount: PanelMount;
  private readonly pointers: UiPointers;
  private readonly labels: VrLabels;
  private readonly hover: RayHover;
  private shown = true;

  constructor(deps: VrUiDeps) {
    const overlay = deps.scene.xr.overlay;
    overlay.transparentSort = reversePainterSortStable;
    this.panel = new VrPanel([
      createTimeTab(deps.time),
      new BodiesTab({ ...deps, lagrangeShown: (): boolean => deps.scene.toggles.lagrange }),
      new InfoTab(deps),
      createViewTab({
        ...deps,
        placement: () => this.mount.placement,
        setPlacement: (placement) => {
          this.mount.placement = placement;
        },
      }),
    ]);
    this.mount = new PanelMount(overlay, this.panel.root);
    this.pointers = new UiPointers(deps.scene.xr, overlay.scene, this.panel.root);
    this.labels = new VrLabels(deps.scene, deps.focused, deps.selected);
    this.hover = new RayHover(deps.scene, deps.system);
  }

  /** Show or hide the panel; showing a pinned one puts it in front of you again. */
  toggle(): void {
    this.shown = !this.shown;
    this.mount.resummon();
  }

  /** Show a short message in the panel's header, as the page shows a toast. */
  say(message: string): void {
    this.panel.say(message, performance.now());
  }

  /** Whether the trigger pull controller `index` last started was on the panel. */
  owns(index: number): boolean {
    return this.shown && this.pointers.owns(index);
  }

  /**
   * Scroll what the right ray points at on the panel by the right stick,
   * `dt` seconds' worth, a little every frame so it glides. Returns whether the
   * stick was the panel's to use: while the ray is on the panel the stick
   * scrolls instead of orbiting, so reading a list never swings the view.
   */
  scroll(stick: Stick, dt: number): boolean {
    const right = this.hover.index;
    if (!this.shown || right === -1 || !this.pointers.over(right)) {
      return false;
    }
    const speed = (lean: number): number =>
      Math.sign(lean) * lean * lean * SCROLL_PX_PER_SECOND * dt;
    if (stick.x !== 0 || stick.y !== 0) {
      // Leaning forward scrolls up, as it would on a phone.
      this.pointers.wheel(right, speed(stick.x), -speed(stick.y));
    }
    return true;
  }

  /** Show the panel in `placement`. */
  showAt(placement: Placement): void {
    this.mount.placement = placement;
    this.shown = true;
  }

  /** Switch between following and pinned, and show the panel; from the wrist, follow. */
  switchRoomPlacement(): Placement {
    this.showAt(this.mount.placement === 'follow' ? 'pinned' : 'follow');
    return this.mount.placement;
  }

  /** One frame: place the panel, refresh what it shows, aim the pointers, label the bodies. */
  update(dt: number): void {
    const now = performance.now();
    this.mount.visible = this.shown;
    this.pointers.enabled = this.shown;
    if (this.shown) {
      this.mount.place(dt);
      this.panel.update(now, dt * 1000);
    }
    // Aimed even while hidden, so the rays get their full length back and the
    // cursor rings go.
    this.pointers.move();
    const right = this.hover.index;
    this.hover.update(now, right !== -1 && this.pointers.over(right));
    this.labels.update(this.hover.body, dt * 1000);
  }
}
