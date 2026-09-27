/**
 * Controller rays as pointers into the VR panel.
 *
 * @pmndrs/pointer-events turns each controller's target-ray space into a
 * pointer that hovers, presses and clicks uikit components the way a mouse
 * does on the page. The trigger is the button: its select start and end are
 * the pointer's down and up.
 *
 * The same trigger also picks bodies in the scene. Which one a pull means is
 * settled when it starts: if the ray was on the panel, the pull belongs to the
 * panel and the body picker leaves it alone.
 *
 * Where a ray meets the panel, the ray stops and a small ring marks the spot,
 * so it is plain what a pull of the trigger will press.
 */

import type { XrRig } from '../../render/scene/xr-rig.ts';
import type { Intersection, Pointer } from '@pmndrs/pointer-events';
import type { Object3D } from 'three';
import { createRayPointer } from '@pmndrs/pointer-events';
import { Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from 'three';
import { COLOR } from './theme.ts';

/**
 * How long a press may last and still count as a click, milliseconds. The
 * library's 300 suits a mouse; a trigger is squeezed and released more slowly.
 */
const CLICK_MS = 600;

/**
 * The cursor ring's radii, metres: at arm's length about half a degree across,
 * big enough to find and small enough to aim a button with.
 */
const CURSOR_INNER = 0.0035;
const CURSOR_OUTER = 0.0055;
/** Lifted this far off the panel toward the viewer, metres, so it never z-fights. */
const CURSOR_LIFT = 0.002;
/** Drawn after the panel and the rays; see the ray's render order in xr-overlay.ts. */
const CURSOR_RENDER_ORDER = 1001;

// Scratch values, reused every frame.
const normal = new Vector3();
const facing = new Quaternion();

function cursorRing(): Mesh {
  const material = new MeshBasicMaterial({
    color: COLOR.accent,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const ring = new Mesh(new RingGeometry(CURSOR_INNER, CURSOR_OUTER, 32), material);
  ring.renderOrder = CURSOR_RENDER_ORDER;
  ring.visible = false;
  return ring;
}

export class UiPointers {
  private readonly pointers: Pointer[];
  private readonly cursors: Mesh[];
  private readonly pressedOnUi: boolean[] = [];
  enabled = true;

  constructor(
    private readonly rig: XrRig,
    private readonly scene: Object3D,
    /** The panel, whose facing the cursor rings take. */
    private readonly surface: Object3D,
  ) {
    this.cursors = rig.controllers.map(() => cursorRing());
    scene.add(...this.cursors);
    this.pointers = rig.controllers.map((controller, index) => {
      const pointer = createRayPointer(
        () => rig.xrCamera,
        { current: controller },
        {},
        { clickThresholdMs: CLICK_MS },
      );
      controller.addEventListener('selectstart', () => {
        this.pressedOnUi[index] = this.enabled && this.over(index);
        pointer.down({ button: 0, timeStamp: performance.now() });
      });
      controller.addEventListener('selectend', () => {
        pointer.up({ button: 0, timeStamp: performance.now() });
      });
      return pointer;
    });
  }

  /** Re-aim every pointer along its controller's ray, and mark where each one lands. */
  move(): void {
    const timeStamp = performance.now();
    this.pointers.forEach((pointer, index) => {
      if (this.enabled) {
        pointer.move(this.scene, { timeStamp });
      }
      this.mark(index, this.enabled ? this.hit(index) : null);
    });
  }

  /** Whether controller `index`'s ray is on the panel right now. */
  over(index: number): boolean {
    return this.hit(index) !== null;
  }

  /** Where controller `index`'s ray meets the panel, or null. */
  private hit(index: number): Intersection | null {
    const intersection = this.pointers[index]?.getIntersection();
    const object = intersection?.object;
    // With nothing hit, the pointer reports a stand-in "void" object.
    if (object === undefined || ('isVoidObject' in object && object.isVoidObject === true)) {
      return null;
    }
    return intersection ?? null;
  }

  /** Stop the ray at the hit and put the cursor ring there, or clear both. */
  private mark(index: number, hit: Intersection | null): void {
    const cursor = this.cursors[index];
    this.rig.overlay.setRayLength(index, hit?.distance ?? null);
    cursor.visible = hit !== null;
    if (!hit) {
      return;
    }
    this.surface.getWorldQuaternion(facing);
    normal.set(0, 0, 1).applyQuaternion(facing);
    cursor.position.copy(hit.point).addScaledVector(normal, CURSOR_LIFT);
    cursor.quaternion.copy(facing);
  }

  /** Whether the trigger pull controller `index` last started was on the panel. */
  owns(index: number): boolean {
    return this.pressedOnUi[index] ?? false;
  }

  /** Scroll whatever controller `index` points at, as a mouse wheel would. */
  wheel(index: number, deltaX: number, deltaY: number): void {
    this.pointers[index]?.wheel(this.scene, {
      timeStamp: performance.now(),
      deltaX,
      deltaY,
      deltaZ: 0,
    });
  }
}
