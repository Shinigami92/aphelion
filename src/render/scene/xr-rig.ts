/**
 * The headset's place in the scene.
 *
 * WebXR hands Three.js a pose for each eye in metres, relative to where the
 * headset was when the session began. The rig is what those poses hang off: it
 * sits exactly where the app's camera is, faces the way it faces, and is scaled
 * to say how much of the scene one metre of head movement spans. Everything
 * that steers the camera — orbiting, flights, free flight, a thumbstick — keeps
 * steering that one camera, and the headset rides along with it; turning your
 * head is a look around from wherever the camera happens to be.
 *
 * Scaling about the eye changes nothing a single eye can see, so the scale only
 * decides what stereo and head movement feel like. There are two:
 *
 *   diorama — the default. The rig is scaled so the camera's near plane lands
 *             five centimetres in front of your eyes. The near plane is already
 *             Aphelion's measure of how much room there is — a fiftieth of the
 *             clearance to the nearest surface or a hundredth of the focus
 *             distance, whichever is less (controls/camera/projection.ts) — so
 *             this puts the nearest surface a few metres away wherever you are.
 *             From four radii out Jupiter is a globe two and a half metres
 *             across, five metres off; from low orbit the ground is a couple of
 *             metres below. Depth and parallax read at a human scale, and the
 *             scale follows every zoom without a jump.
 *   true    — a metre is a metre. Your eyes are centimetres apart in a solar system,
 *             so nothing shows stereo depth, just as nothing would to an
 *             astronaut, and leaning moves you by exactly as much as you lean.
 *
 * Everything the viewer handles in metres — the controllers, the VR panels,
 * the labels — lives in the overlay instead (xr-overlay.ts), whose rig turns
 * with this one but is never moved or scaled.
 */

import type { PickView } from './picking.ts';
import type {
  PerspectiveCamera as AppCamera,
  ArrayCamera,
  Scene,
  WebGLRenderer,
  XRTargetRaySpace,
} from 'three';
import { Group, Matrix4, PerspectiveCamera, Vector2 } from 'three';
import { SCENE_UNIT_KM } from '../../core/constants.ts';
import { XrOverlay } from './xr-overlay.ts';

export type XrScale = 'diorama' | 'true';

/** Metres in one scene unit. */
const METRES_PER_UNIT = SCENE_UNIT_KM * 1000;

/** Where the near plane sits in diorama scale, in metres from the eyes. */
const DIORAMA_NEAR_METRES = 0.05;

/**
 * The furthest the near plane may sit from the eyes, in metres. Diorama scale
 * puts it at five centimetres anyway (rounded down to 2^-5 m); at true scale
 * it would otherwise be tens of metres out and clip the overlay's panels, which
 * share the world's planes. The logarithmic depth buffer makes a close near
 * plane cost nothing.
 */
const MAX_NEAR_METRES = 2 ** -5;

/**
 * The image a pointer ray is aimed through, for picking.
 *
 * The same field of view as the desktop camera, so the pixel rules in the
 * picker (what counts as a disc, how far a click may miss) mean the same angles
 * here; the tolerance is then about three degrees, which a hand can hit even
 * at a planet that is a single pixel, and the hover label shows what it will
 * pick before the trigger is pulled.
 */
const RAY_FOV = 55;
const RAY_VIEWPORT = new Vector2(1000, 1000);
export const RAY_PICK_TOLERANCE = 55;

/**
 * Round out to a power of two.
 *
 * WebXR takes new clip planes through `updateRenderState`, a round trip that
 * lands a frame late. The camera recomputes its planes on every frame it moves,
 * and rounding them outward leaves the headset's alone through most of a zoom.
 */
function roundDown(x: number): number {
  return 2 ** Math.floor(Math.log2(x));
}

function roundUp(x: number): number {
  return 2 ** Math.ceil(Math.log2(x));
}

export class XrRig {
  /** Stands in for the app camera; the eye poses are relative to it. */
  readonly dolly = new Group();
  /** The camera the renderer draws the headset's view with. */
  readonly head = new PerspectiveCamera();
  /** What is drawn in metres around the viewer, over the world. */
  readonly overlay: XrOverlay;

  scale: XrScale = 'diorama';

  private readonly rayMatrix = new Matrix4();
  private readonly rayCamera = new PerspectiveCamera(RAY_FOV, 1, 1e-6, 1e13);
  private readonly mirror = new PerspectiveCamera();

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
  ) {
    renderer.xr.enabled = true;
    // 'local' puts the origin at the eyes rather than on the floor, so the app
    // camera is where the viewer's head is and not 1.6 metres below it.
    renderer.xr.setReferenceSpaceType('local');

    this.dolly.add(this.head);
    scene.add(this.dolly);
    this.overlay = new XrOverlay(renderer);
  }

  /** Each controller's pointing pose, in the overlay's room frame. */
  get controllers(): ReadonlyArray<XRTargetRaySpace> {
    return this.overlay.controllers;
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  get session(): XRSession | null {
    return this.renderer.xr.getSession();
  }

  /** The stereo camera WebXR drew the latest pass with. */
  get xrCamera(): ArrayCamera {
    return this.renderer.xr.getCamera();
  }

  /** Hand an immersive session to the renderer; resolves once it presents. */
  async start(session: XRSession): Promise<void> {
    await this.renderer.xr.setSession(session);
  }

  /**
   * Call `callback` whenever a session ends, once Three.js has handed the canvas
   * back at its old size. The session's own `end` event fires before that, while
   * the renderer still counts as presenting and refuses to be resized.
   */
  onSessionEnd(callback: () => void): void {
    this.renderer.xr.addEventListener('sessionend', callback);
  }

  /**
   * Run the frame loop from the renderer, which asks the headset for frames
   * while a session is presenting and the window otherwise. A headset only
   * shows what is drawn inside its own frame callback.
   */
  setAnimationLoop(callback: XRFrameRequestCallback | null): void {
    this.renderer.setAnimationLoop(callback);
  }

  /** Stand the rig where the app camera is, at the current scale. */
  sync(camera: AppCamera): void {
    const unitsPerMetre =
      this.scale === 'true' ? 1 / METRES_PER_UNIT : camera.near / DIORAMA_NEAR_METRES;
    this.dolly.position.copy(camera.position);
    this.dolly.quaternion.copy(camera.quaternion);
    this.dolly.scale.setScalar(unitsPerMetre);
    this.dolly.updateMatrixWorld(true);

    // The head sees the camera's own clip planes, measured in its metres.
    this.head.near = Math.min(roundDown(camera.near / unitsPerMetre), MAX_NEAR_METRES);
    this.head.far = roundUp(camera.far / unitsPerMetre);
    this.overlay.sync(this.dolly.quaternion, this.head.near, this.head.far);
  }

  /** Draw the overlay over the world frame just rendered. */
  renderOverlay(): void {
    this.overlay.render(this.renderer);
  }

  /**
   * The head's view through the app camera's lens, for mirroring onto the page.
   *
   * Where the head is and where it looks, at the desktop's field of view — which
   * is narrower than the headset's, so the page shows the middle of what the
   * wearer sees. Valid once a headset frame has been drawn: that is when
   * Three.js poses the head.
   */
  mirrorView(camera: AppCamera, aspect: number): PerspectiveCamera {
    const mirror = this.mirror;
    this.head.matrixWorld.decompose(mirror.position, mirror.quaternion, mirror.scale);
    mirror.scale.set(1, 1, 1);
    mirror.fov = camera.fov;
    mirror.aspect = aspect;
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.updateProjectionMatrix();
    mirror.updateMatrixWorld(true);
    return mirror;
  }

  /**
   * A view looking down a controller's pointer ray, or null while it is not
   * tracked. The controller's pose is relative to the viewer's reference space;
   * standing the world rig on it puts the ray in render space, where the bodies
   * are, computed in double precision whatever the scale.
   */
  rayView(index: number): PickView | null {
    const controller = this.controllers[index];
    if (!controller.visible) {
      return null;
    }
    const camera = this.rayCamera;
    this.rayMatrix.multiplyMatrices(this.dolly.matrixWorld, controller.matrix);
    this.rayMatrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.scale.set(1, 1, 1);
    camera.updateMatrixWorld(true);
    return { camera, viewport: RAY_VIEWPORT };
  }
}
