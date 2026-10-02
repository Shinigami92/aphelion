/**
 * The headset's overlay: what is drawn in metres around the viewer rather than
 * in the solar system — the controllers' pointer rays, the VR panels and the
 * body labels.
 *
 * It cannot hang off the world rig. That rig is scaled to decide what a metre
 * of head movement spans, and at true scale a panel half a metre away is five
 * ten-millionths of a scene unit from the eye: under float32 resolution
 * anywhere but the origin, so it would render as noise. The overlay is its own
 * scene instead, with an unscaled rig at the origin, drawn in a second pass
 * over the world with the depth buffer cleared. Nothing in it can sink into a
 * planet, and it is equally sharp at both scales.
 *
 * Its rig turns with the world rig but never moves or scales, so the overlay's
 * axes are the solar system's: a direction from the eye to a body is the same
 * direction here, which is how labels find their bodies. Everything under the
 * rig is in the viewer's room frame, in metres.
 *
 * The page's mirror draws only the world by default, and the page keeps its
 * own 2D panels and labels; the U key draws this over the mirror as well, for
 * whoever is watching the wearer use it.
 */

import type { Quaternion, WebGLRenderer, XRGripSpace, XRTargetRaySpace } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';

/**
 * How far each controller's pointer ray is drawn, in metres, when it hits no
 * panel. Long, so it points visibly at a speck of a planet across the room
 * rather than stopping at arm's length; it fades out along its length.
 */
const RAY_METRES = 8;

/**
 * Drawn after everything else in the overlay. A panel is translucent, so if
 * it came second it would be blended over the ray even where the ray is in
 * front of it; drawn last, the depth test still hides whatever part of the ray
 * is behind a panel.
 */
const RAY_RENDER_ORDER = 1000;

type TransparentSort = Parameters<WebGLRenderer['setTransparentSort']>[0];

/** A bright line fading out along the controller's -z, which is where it aims. */
function pointerRay(): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -RAY_METRES], 3));
  geometry.setAttribute('color', new Float32BufferAttribute([0.55, 0.75, 1, 0, 0, 0], 3));
  const material = new LineBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  line.renderOrder = RAY_RENDER_ORDER;
  return line;
}

export class XrOverlay {
  readonly scene = new Scene();
  /** The viewer's room frame: at the origin, turned like the world rig. */
  readonly dolly = new Group();
  /** The camera the renderer draws the overlay with. */
  readonly head = new PerspectiveCamera();
  /** Each controller's pointing pose, which is where its ray starts. */
  readonly controllers: XRTargetRaySpace[] = [];
  /** Each controller's grip pose, where the hand holds it. */
  readonly grips: XRGripSpace[] = [];
  /** Which hand each controller slot is, once it has connected. */
  readonly handedness: XRHandedness[] = ['none', 'none'];
  private readonly rays: Line[] = [];
  private readonly mirror = new PerspectiveCamera();
  /**
   * The transparent sort for this pass only. The UI library orders its own
   * meshes with one; the world keeps Three.js's default.
   */
  transparentSort: TransparentSort = null;

  constructor(renderer: WebGLRenderer) {
    this.dolly.add(this.head);
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const ray = pointerRay();
      controller.add(ray);
      this.rays.push(ray);
      controller.addEventListener('connected', (event) => {
        this.handedness[i] = event.data.handedness;
      });
      controller.addEventListener('disconnected', () => {
        this.handedness[i] = 'none';
      });
      const grip = renderer.xr.getControllerGrip(i);
      this.dolly.add(controller, grip);
      this.controllers.push(controller);
      this.grips.push(grip);
    }
    this.scene.add(this.dolly);
  }

  /**
   * End controller `index`'s ray `metres` out, where it meets a panel, or
   * give it back its full length with null.
   */
  setRayLength(index: number, metres: number | null): void {
    this.rays[index].scale.z = metres === null ? 1 : metres / RAY_METRES;
  }

  /** The grip space of the controller held in `hand`, or null while there is none. */
  grip(hand: 'left' | 'right'): XRGripSpace | null {
    const index = this.handedness.indexOf(hand);
    return index === -1 ? null : this.grips[index];
  }

  /**
   * Turn with the world rig and share its clip planes. Two passes asking WebXR
   * for different planes would flip `updateRenderState` twice every frame.
   */
  sync(worldRotation: Quaternion, near: number, far: number): void {
    this.dolly.quaternion.copy(worldRotation);
    this.dolly.updateMatrixWorld(true);
    this.head.near = near;
    this.head.far = far;
  }

  /** Draw over whatever the renderer has already drawn this frame, as `camera` sees it. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera = this.head): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setTransparentSort(this.transparentSort);
    renderer.render(this.scene, camera);
    renderer.setTransparentSort(null);
    renderer.autoClear = autoClear;
  }

  /**
   * Draw over the page's mirror: from the head's pose in this scene, through
   * `lens`, the mirror's own camera, so the overlay lines up with the world it
   * was drawn over. Valid once a headset frame has posed the head.
   */
  renderMirror(renderer: WebGLRenderer, lens: PerspectiveCamera): void {
    const mirror = this.mirror;
    this.head.matrixWorld.decompose(mirror.position, mirror.quaternion, mirror.scale);
    mirror.scale.set(1, 1, 1);
    mirror.fov = lens.fov;
    mirror.aspect = lens.aspect;
    mirror.near = this.head.near;
    mirror.far = this.head.far;
    mirror.updateProjectionMatrix();
    mirror.updateMatrixWorld(true);
    this.render(renderer, mirror);
  }
}
