/**
 * Camera control.
 *
 * Two modes:
 *   orbit — the default. The camera is a spherical offset from a focused body,
 *           which stays pinned at the render-space origin. Because the focus is
 *           the origin, float32 precision is spent where it matters and you can
 *           sit on Enceladus's surface with Saturn 240,000 km away and neither
 *           jitters.
 *   free  — six-degree-of-freedom flight for getting between things.
 *
 * Input is unified across mouse and trackpad: drag to look, wheel/pinch to zoom
 * (the wheel sets flight speed, in free mode), modifier-drag to pan. Every
 * action also has a key.
 *
 * `CameraController` is the public face. The state lives in one `CameraState`
 * and each concern — orbiting, free flight, cinematic flights, shared views,
 * pointer input, clip planes — is a module under camera/ working on it.
 */

import type { SimBody } from '../core/system.ts';
import type { CameraKeyState } from './camera/keys.ts';
import type { CameraMode } from './camera/state.ts';
import type { PerspectiveCamera } from 'three';
import { flyTo, updateFlight } from './camera/flight.ts';
import { lookAtFocus, toggleMode, updateFree } from './camera/free.ts';
import { CameraInput } from './camera/input.ts';
import { cancelFlight, frameSystem, setFocus, updateOrbit } from './camera/orbit.ts';
import { updateProjection } from './camera/projection.ts';
import { freeView, restoreFreeView, restoreView } from './camera/shared.ts';
import { CameraState } from './camera/state.ts';

export class CameraController {
  private readonly s: CameraState;
  private readonly input: CameraInput;

  /** Called with the new multiplier when the wheel changes free-flight speed. */
  onFreeSpeedChange: ((factor: number) => void) | null = null;

  constructor(aspect: number) {
    this.s = new CameraState(aspect);
    this.input = new CameraInput(this.s, (factor) => {
      this.onFreeSpeedChange?.(factor);
    });
  }

  get camera(): PerspectiveCamera {
    return this.s.camera;
  }

  get mode(): CameraMode {
    return this.s.mode;
  }

  get keys(): CameraKeyState {
    return this.s.keys;
  }

  set keys(keys: CameraKeyState) {
    this.s.keys = keys;
  }

  /**
   * Body the camera orbits — the single owner of "what is focused".
   *
   * Read-only on purpose. This was a public field, and assigning to it directly
   * left the renderer's floating origin anchored to the *previous* body: the
   * camera then orbited a point in empty space, with no error raised anywhere
   * and nothing in the console. Routing every change through setFocus() or
   * frameSystem() makes that state unreachable, and makes the mistake a compile
   * error rather than a black screen.
   */
  get focus(): SimBody | null {
    return this.s.focus;
  }

  /** How hard the camera is currently travelling, for the dust field. */
  get travelling(): number {
    return this.s.travelIntensity;
  }

  /** performance.now() of the last real user input. */
  get lastInputAt(): number {
    return this.s.lastInputAt;
  }

  /** Set when the user changes the view, so the UI can hide hints. */
  get interacted(): boolean {
    return this.s.interacted;
  }

  // -- focus ---------------------------------------------------------------

  /** Focus a body, framed a few radii out. See `setFocus` in camera/orbit.ts. */
  setFocus(
    body: SimBody,
    opts: {
      immediate?: boolean;
      distanceRadii?: number;
      arriveFrom?: { x: number; y: number; z: number };
    } = {},
  ): void {
    setFocus(this.s, body, opts);
  }

  /** Fly to a body instead of cutting to it. See `flyTo` in camera/flight.ts. */
  flyTo(
    body: SimBody,
    opts: { arriveFrom?: { x: number; y: number; z: number }; onArrive?: () => void } = {},
  ): void {
    flyTo(this.s, body, opts);
  }

  /** Abandon a flight in progress, keeping wherever the camera has reached. */
  cancelFlight(): void {
    cancelFlight(this.s);
  }

  /** Frame a body and all of its satellites. */
  frameSystem(body: SimBody, maxChildDistance: number): void {
    frameSystem(this.s, body, maxChildDistance);
  }

  get currentDistance(): number {
    return this.s.distance;
  }

  /**
   * True while the camera is still easing toward its target. The frame governor
   * uses this to keep drawing at full rate through a fly-to, and to stop as soon
   * as the motion has actually settled.
   *
   * Only orbit mode eases. Free flight leaves the orbit targets alone, so a
   * drag still easing when V was pressed used to read as settling for as long
   * as free flight lasted, and pinned the governor at full rate.
   */
  get isSettling(): boolean {
    const s = this.s;
    if (s.flight) {
      return true;
    }
    return (
      s.mode === 'orbit' &&
      (Math.abs(s.distance - s.targetDistance) > s.targetDistance * 1e-4 ||
        Math.abs(s.azimuth - s.targetAzimuth) > 1e-4 ||
        Math.abs(s.elevation - s.targetElevation) > 1e-4 ||
        Math.abs(s.roll - s.targetRoll) > 1e-4)
    );
  }

  /** Distance from the focus surface, scene units (negative inside the body). */
  altitude(): number {
    if (!this.s.focus) {
      return this.s.distance;
    }
    return this.s.distance - this.s.focus.sceneRadius;
  }

  /** Orbit angles, exposed so the view can be written into a shareable URL. */
  get orbitAzimuth(): number {
    return this.s.azimuth;
  }

  get orbitElevation(): number {
    return this.s.elevation;
  }

  /** Distance from the focus centre in radii of the focused body. */
  get distanceInRadii(): number {
    const radius = this.s.focus?.sceneRadius ?? 0;
    return radius > 0 ? this.s.distance / radius : 0;
  }

  // -- shared views ----------------------------------------------------------

  /** Restore a view decoded from a URL, without animation. See camera/shared.ts. */
  restoreView(view: { azimuth?: number; elevation?: number; distanceRadii?: number }): void {
    restoreView(this.s, view);
  }

  /** Free-flight position and orientation for a shareable link; null while orbiting. */
  freeView(): {
    position: [number, number, number];
    orientation: [number, number, number, number];
  } | null {
    return freeView(this.s);
  }

  /** Put the camera back into free flight exactly where a link left it. */
  restoreFreeView(view: {
    position: readonly [number, number, number];
    orientation?: readonly [number, number, number, number] | null;
  }): void {
    restoreFreeView(this.s, view);
  }

  // -- per-frame -----------------------------------------------------------

  update(dt: number): void {
    if (this.s.flight) {
      updateFlight(this.s, dt);
    } else if (this.s.mode === 'orbit') {
      updateOrbit(this.s, dt);
    } else {
      updateFree(this.s, dt);
    }
    updateProjection(this.s);
  }

  /**
   * Distance to the nearest body's surface, scene units, in free flight.
   * Supplied per frame by the caller, which is the thing that owns the system.
   * Negative when the camera is inside a body.
   */
  setNearestSurface(distance: number): void {
    this.s.nearestSurface = distance;
  }

  setAspect(aspect: number): void {
    this.s.camera.aspect = aspect;
    this.s.camera.updateProjectionMatrix();
  }

  // -- modes ---------------------------------------------------------------

  toggleMode(): CameraMode {
    return toggleMode(this.s);
  }

  /** Point the free camera at the render-space origin. */
  lookAtFocus(): void {
    lookAtFocus(this.s);
  }

  // -- input ---------------------------------------------------------------

  attach(element: HTMLElement): void {
    this.input.attach(element);
  }

  detach(): void {
    this.input.detach();
  }
}
