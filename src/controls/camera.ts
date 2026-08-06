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
 * (or to move, in free mode), modifier-drag to pan. Every action also has a key.
 */

import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { SimBody } from '../core/system.ts'

export type CameraMode = 'orbit' | 'free'

const DEG = Math.PI / 180
const MAX_ELEVATION = 89.5 * DEG

export interface CameraKeyState {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  rollLeft: boolean
  rollRight: boolean
  boost: boolean
  precise: boolean
  orbitLeft: boolean
  orbitRight: boolean
  orbitUp: boolean
  orbitDown: boolean
  zoomIn: boolean
  zoomOut: boolean
}

/**
 * The representative of `target` closest to `current`, so easing to a new
 * azimuth always takes the short way round rather than unwinding several turns.
 */
function nearestAngle(current: number, target: number): number {
  const twoPi = Math.PI * 2
  let delta = (target - current) % twoPi
  if (delta > Math.PI) delta -= twoPi
  if (delta < -Math.PI) delta += twoPi
  return current + delta
}

const emptyKeys = (): CameraKeyState => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  rollLeft: false,
  rollRight: false,
  boost: false,
  precise: false,
  orbitLeft: false,
  orbitRight: false,
  orbitUp: false,
  orbitDown: false,
  zoomIn: false,
  zoomOut: false,
})

export class CameraController {
  readonly camera: PerspectiveCamera
  mode: CameraMode = 'orbit'
  keys: CameraKeyState = emptyKeys()

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
  private _focus: SimBody | null = null

  get focus(): SimBody | null {
    return this._focus
  }

  /** Distance from the focus centre, in scene units. */
  private distance = 40
  private targetDistance = 40
  /** Azimuth and elevation of the camera about the focus, radians. */
  private azimuth = 0.6
  private elevation = 0.32
  private targetAzimuth = 0.6
  private targetElevation = 0.32

  /** Pan offset from the focus centre, in the camera's own basis. */
  private panOffset = new Vector3()

  /** Free-flight state. */
  private freePosition = new Vector3(0, -400, 120)
  private freeQuaternion = new Quaternion()
  private freeSpeed = 200

  /** Smoothed follow of the focus so scale transitions do not snap. */
  private focusTransition = 0

  private dragging: 'none' | 'orbit' | 'pan' = 'none'
  private lastPointer = { x: 0, y: 0 }
  private activePointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0

  private element: HTMLElement | null = null
  private detachers: (() => void)[] = []

  /** Set when the user changes the view, so the UI can hide hints. */
  interacted = false

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.01, 1e9)
    this.camera.up.set(0, 0, 1) // ecliptic north is +z in our frame
  }

  // -- focus ---------------------------------------------------------------

  /**
   * Focus a body. The default framing puts the body at a comfortable few radii
   * so you can see it and some of its surroundings.
   *
   * Pass `sunward` (a unit vector from the body toward the Sun, in the world
   * frame) to be placed over the daylit hemisphere. Without it you arrive on
   * whichever side the previous azimuth happened to point at, which for the
   * outer planets is usually the unlit one — you fly to Saturn and find a black
   * disc.
   */
  setFocus(
    body: SimBody,
    opts: {
      immediate?: boolean
      distanceRadii?: number
      sunward?: { x: number; y: number; z: number }
    } = {},
  ): void {
    const previous = this._focus
    this._focus = body

    const radius = Math.max(body.sceneRadius, 1e-4)
    const radii = opts.distanceRadii ?? (body.type === 'star' ? 6 : 4.2)
    this.targetDistance = radius * radii
    this.panOffset.set(0, 0, 0)

    if (opts.sunward) {
      // Just off the Sun-body line, so most of the disc is lit but the
      // terminator is still in frame.
      const desired = Math.atan2(opts.sunward.y, opts.sunward.x) + 0.6
      this.targetAzimuth = nearestAngle(this.azimuth, desired)
      this.targetElevation = 0.3
    }

    if (opts.immediate || !previous) {
      this.distance = this.targetDistance
      this.azimuth = this.targetAzimuth
      this.elevation = this.targetElevation
      this.focusTransition = 1
    } else {
      // Ease in from wherever we were.
      this.focusTransition = 0
    }
    this.mode = 'orbit'
  }

  /** Frame a body and all of its satellites. */
  frameSystem(body: SimBody, maxChildDistance: number): void {
    this._focus = body
    this.targetDistance = Math.max(body.sceneRadius * 3, maxChildDistance * 1.6)
    this.panOffset.set(0, 0, 0)
    this.mode = 'orbit'
  }

  get currentDistance(): number {
    return this.distance
  }

  /** Distance from the focus surface, scene units (negative inside the body). */
  altitude(): number {
    if (!this._focus) return this.distance
    return this.distance - this._focus.sceneRadius
  }

  // -- per-frame -----------------------------------------------------------

  update(dt: number): void {
    if (this.mode === 'orbit') this.updateOrbit(dt)
    else this.updateFree(dt)
    this.updateProjection()
  }

  private updateOrbit(dt: number): void {
    const k = 1 - Math.exp(-dt / 0.09)

    // Keyboard orbiting and zoom.
    const speed = this.keys.precise ? 0.25 : this.keys.boost ? 3 : 1
    const rate = 1.5 * dt * speed
    if (this.keys.orbitLeft) this.targetAzimuth -= rate
    if (this.keys.orbitRight) this.targetAzimuth += rate
    if (this.keys.orbitUp) this.targetElevation = Math.min(MAX_ELEVATION, this.targetElevation + rate)
    if (this.keys.orbitDown) this.targetElevation = Math.max(-MAX_ELEVATION, this.targetElevation - rate)
    const zoomRate = Math.exp((this.keys.boost ? 2.4 : 1.1) * dt)
    if (this.keys.zoomIn) this.targetDistance /= zoomRate
    if (this.keys.zoomOut) this.targetDistance *= zoomRate

    // Also let WASD drive the orbit, so one hand can do everything.
    if (this.keys.forward) this.targetDistance /= zoomRate
    if (this.keys.back) this.targetDistance *= zoomRate
    if (this.keys.left) this.targetAzimuth -= rate
    if (this.keys.right) this.targetAzimuth += rate
    if (this.keys.up) this.targetElevation = Math.min(MAX_ELEVATION, this.targetElevation + rate)
    if (this.keys.down) this.targetElevation = Math.max(-MAX_ELEVATION, this.targetElevation - rate)

    this.clampDistance()

    this.azimuth += (this.targetAzimuth - this.azimuth) * k
    this.elevation += (this.targetElevation - this.elevation) * k
    this.distance += (this.targetDistance - this.distance) * k
    this.focusTransition += (1 - this.focusTransition) * k

    // Spherical to Cartesian, z up.
    const cosE = Math.cos(this.elevation)
    const offset = new Vector3(
      this.distance * cosE * Math.cos(this.azimuth),
      this.distance * cosE * Math.sin(this.azimuth),
      this.distance * Math.sin(this.elevation),
    )

    // The focus sits at the render-space origin.
    this.camera.position.copy(offset).add(this.panOffset)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(this.panOffset)
    this.freePosition.copy(this.camera.position)
    this.freeQuaternion.copy(this.camera.quaternion)
  }

  private updateFree(dt: number): void {
    const boost = this.keys.boost ? 8 : this.keys.precise ? 0.12 : 1
    const step = this.freeSpeed * boost * dt

    const forward = new Vector3(0, 0, -1).applyQuaternion(this.freeQuaternion)
    const right = new Vector3(1, 0, 0).applyQuaternion(this.freeQuaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(this.freeQuaternion)

    if (this.keys.forward) this.freePosition.addScaledVector(forward, step)
    if (this.keys.back) this.freePosition.addScaledVector(forward, -step)
    if (this.keys.right) this.freePosition.addScaledVector(right, step)
    if (this.keys.left) this.freePosition.addScaledVector(right, -step)
    if (this.keys.up) this.freePosition.addScaledVector(up, step)
    if (this.keys.down) this.freePosition.addScaledVector(up, -step)

    const roll = 1.4 * dt * (this.keys.boost ? 2 : 1)
    if (this.keys.rollLeft) this.rollFree(-roll)
    if (this.keys.rollRight) this.rollFree(roll)

    this.camera.position.copy(this.freePosition)
    this.camera.quaternion.copy(this.freeQuaternion)
    // Keep the orbit state coherent so switching back is not jarring.
    this.distance = Math.max(this.freePosition.length(), 1e-4)
    this.targetDistance = this.distance
  }

  private rollFree(amount: number): void {
    const axis = new Vector3(0, 0, -1).applyQuaternion(this.freeQuaternion)
    this.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(axis, amount))
  }

  /**
   * Near and far planes derived from the current distance.
   *
   * The scene spans eleven orders of magnitude, so fixed planes cannot work. We
   * pick a window around the camera each frame; combined with the logarithmic
   * depth buffer this keeps a spacecraft-scale foreground and a Neptune-scale
   * background in the same image without z-fighting.
   */
  private updateProjection(): void {
    const surface = this._focus
      ? Math.max(this.distance - this._focus.sceneRadius, 1e-5)
      : this.distance
    const near = Math.max(1e-5, Math.min(surface * 0.02, this.distance * 0.01))
    const far = Math.max(near * 1e6, this.distance * 4e4 + 1e6)
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near
      this.camera.far = far
      this.camera.updateProjectionMatrix()
    }
  }

  private clampDistance(): void {
    const minimum = this._focus ? this._focus.sceneRadius * 1.02 : 1e-4
    this.targetDistance = Math.max(minimum, Math.min(this.targetDistance, 4e7))
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  // -- modes ---------------------------------------------------------------

  toggleMode(): CameraMode {
    if (this.mode === 'orbit') {
      this.mode = 'free'
      this.freePosition.copy(this.camera.position)
      this.freeQuaternion.copy(this.camera.quaternion)
      // Scale flight speed to whatever we are looking at.
      this.freeSpeed = Math.max(this.distance * 0.35, 1)
    } else {
      this.mode = 'orbit'
    }
    return this.mode
  }

  /** Point the free camera at the render-space origin. */
  lookAtFocus(): void {
    if (this.mode !== 'free') return
    const m = this.camera.clone()
    m.position.copy(this.freePosition)
    m.up.set(0, 0, 1)
    m.lookAt(0, 0, 0)
    this.freeQuaternion.copy(m.quaternion)
  }

  // -- input ---------------------------------------------------------------

  attach(element: HTMLElement): void {
    this.element = element
    const add = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      element.addEventListener(type, handler as EventListener, opts)
      this.detachers.push(() => element.removeEventListener(type, handler as EventListener))
    }

    add('pointerdown', (ev) => this.onPointerDown(ev))
    add('pointermove', (ev) => this.onPointerMove(ev))
    add('pointerup', (ev) => this.onPointerUp(ev))
    add('pointercancel', (ev) => this.onPointerUp(ev))
    add('wheel', (ev) => this.onWheel(ev), { passive: false })
    add('contextmenu', (ev) => ev.preventDefault())
  }

  detach(): void {
    for (const off of this.detachers) off()
    this.detachers = []
    this.element = null
  }

  private onPointerDown(ev: PointerEvent): void {
    this.element?.setPointerCapture?.(ev.pointerId)
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    this.lastPointer = { x: ev.clientX, y: ev.clientY }

    if (this.activePointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance()
      this.dragging = 'none'
      return
    }
    // Middle button, right button or shift-drag pans; anything else rotates.
    this.dragging = ev.button === 1 || ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit'
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.activePointers.has(ev.pointerId)) return
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })

    // Two-finger pinch on a touch screen.
    if (this.activePointers.size === 2) {
      const d = this.currentPinchDistance()
      if (this.pinchDistance > 0 && d > 0) {
        this.zoomBy(this.pinchDistance / d)
        this.interacted = true
      }
      this.pinchDistance = d
      return
    }

    const dx = ev.clientX - this.lastPointer.x
    const dy = ev.clientY - this.lastPointer.y
    this.lastPointer = { x: ev.clientX, y: ev.clientY }
    if (dx === 0 && dy === 0) return
    this.interacted = true

    if (this.mode === 'free') {
      if (this.dragging === 'none') return
      this.lookBy(dx * 0.0026, dy * 0.0026)
      return
    }

    if (this.dragging === 'orbit') {
      this.targetAzimuth -= dx * 0.005
      this.targetElevation = Math.max(
        -MAX_ELEVATION,
        Math.min(MAX_ELEVATION, this.targetElevation + dy * 0.005),
      )
    } else if (this.dragging === 'pan') {
      // Pan in the camera plane, scaled so the drag tracks the cursor.
      const scale = this.distance * 0.0016
      const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0)
      const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1)
      this.panOffset.addScaledVector(right, -dx * scale)
      this.panOffset.addScaledVector(up, dy * scale)
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    this.activePointers.delete(ev.pointerId)
    if (this.activePointers.size < 2) this.pinchDistance = 0
    if (this.activePointers.size === 0) this.dragging = 'none'
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault()
    this.interacted = true

    // A trackpad pinch arrives as a wheel event with ctrlKey set; plain
    // two-finger scrolling arrives as small deltas. Both should zoom, but at
    // different sensitivities or pinching feels sluggish.
    const pinch = ev.ctrlKey
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1
    const delta = ev.deltaY * unit
    const sensitivity = pinch ? 0.012 : 0.0016

    if (this.mode === 'free') {
      this.freeSpeed = Math.max(0.01, this.freeSpeed * Math.exp(-delta * sensitivity))
      return
    }
    this.zoomBy(Math.exp(delta * sensitivity))
  }

  private zoomBy(factor: number): void {
    this.targetDistance *= factor
    this.clampDistance()
  }

  private lookBy(yaw: number, pitch: number): void {
    const yawAxis = new Vector3(0, 1, 0).applyQuaternion(this.freeQuaternion)
    const pitchAxis = new Vector3(1, 0, 0).applyQuaternion(this.freeQuaternion)
    this.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(yawAxis, -yaw))
    this.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(pitchAxis, -pitch))
    this.freeQuaternion.normalize()
  }

  private currentPinchDistance(): number {
    const pts = [...this.activePointers.values()]
    if (pts.length < 2) return 0
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
  }
}
