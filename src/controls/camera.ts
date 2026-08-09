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

/**
 * Free-flight speed as a fraction of the clearance ahead, per second.
 *
 * 0.15 means you close about 15% of the gap to the nearest surface each second,
 * so an Earth-to-Mars crossing runs a little over ten seconds unboosted while a
 * final approach decays smoothly to a crawl. Shift multiplies it eightfold.
 */
const FREE_SPEED_PER_UNIT = 0.15
/** Enough to still manoeuvre when parked against a surface. */
const MIN_FREE_SPEED = 0.05
/** Keeps deep Kuiper emptiness from producing an unusable jump per frame. */
const MAX_FREE_SPEED = 30_000
/**
 * Most of the remaining gap a single frame may close. Below 1 this is a
 * geometric approach, so the surface is a limit rather than a thing you hit —
 * and it holds however hard the boost key is pressed.
 */
const MAX_STEP_FRACTION = 0.35

/**
 * Seconds for a cinematic approach, from the trip length in destination radii.
 *
 * Logarithmic, because the range is enormous — a few radii to a moon, tens of
 * millions to cross the system — and clamped so nothing is either a jump cut or
 * a wait. Earth to Mars lands around eight seconds.
 */
function flightDuration(radiiTravelled: number): number {
  const decades = Math.log10(Math.max(radiiTravelled, 1))
  return Math.max(2.2, Math.min(9, 1.8 + decades * 1.5))
}

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

  /**
   * Roll about the view axis while orbiting, radians.
   *
   * Orbit mode pins `up` to ecliptic north and re-runs `lookAt` every frame, so
   * roll cannot live in the quaternion the way it does in free flight — it is
   * re-applied after the look, on top of a fresh orientation.
   */
  private roll = 0
  private targetRoll = 0

  /** Pan offset from the focus centre, in the camera's own basis. */
  private panOffset = new Vector3()

  /** Free-flight state. */
  private freePosition = new Vector3(0, -400, 120)
  private freeQuaternion = new Quaternion()
  private freeSpeed = 200

  /** Smoothed follow of the focus so scale transitions do not snap. */
  private focusTransition = 0

  /**
   * A cinematic approach in progress.
   *
   * Focus switches to the destination the moment a flight starts, so the world
   * is already centred there and every coordinate below is stable for the whole
   * trip; the camera is then flown by hand from wherever it was to the framing
   * position, and handed back to the orbit controller on arrival.
   */
  private flight: {
    elapsed: number
    duration: number
    fromPosition: Vector3
    fromQuaternion: Quaternion
    toDistance: number
    toAzimuth: number
    toElevation: number
  } | null = null

  /** 0 while parked, rising to 1 at the fastest part of a flight. */
  private travelIntensity = 0

  /** How hard the camera is currently travelling, for the dust field. */
  get travelling(): number {
    return this.travelIntensity
  }

  private dragging: 'none' | 'orbit' | 'pan' = 'none'
  private lastPointer = { x: 0, y: 0 }
  private activePointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0
  /** Midpoint of a two-finger gesture, which pans as it travels. */
  private pinchCentre = { x: 0, y: 0 }

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

  /**
   * Fly to a body instead of cutting to it: turn toward it, cross the distance
   * over several seconds, and settle into the framing `setFocus` would have
   * chosen.
   *
   * The duration comes from how far the trip actually is in units of the
   * destination's own size, so hopping to a nearby moon stays brisk while Mars
   * to Earth takes the better part of ten seconds. Interrupting is deliberate:
   * any drag, key or wheel cancels the flight and leaves the camera wherever it
   * had reached, rather than fighting the user for the remaining seconds.
   */
  flyTo(body: SimBody, opts: { sunward?: { x: number; y: number; z: number } } = {}): void {
    const previous = this._focus

    // Where the camera is now, relative to the destination — captured before
    // the focus changes, because that is the frame the flight is flown in.
    // The renderer centres the world on the focus, so the camera's position is
    // relative to `previous`; shifting by the gap between the two bodies puts it
    // in the destination's frame, which is where the whole flight is computed.
    const from = this.camera.position.clone()
    if (previous && previous !== body) {
      from.x += previous.scene.x - body.scene.x
      from.y += previous.scene.y - body.scene.y
      from.z += previous.scene.z - body.scene.z
    }

    const fromQuaternion = this.camera.quaternion.clone()

    // Let setFocus pick the destination framing, then take the numbers back.
    this.setFocus(body, { ...opts, immediate: true })

    const travel = from.length()
    const radius = Math.max(body.sceneRadius, 1e-4)
    // Nothing to fly if we are already framed on it.
    if (travel < this.targetDistance * 1.2) return

    this.flight = {
      elapsed: 0,
      duration: flightDuration(travel / radius),
      fromPosition: from,
      fromQuaternion,
      toDistance: this.targetDistance,
      toAzimuth: this.targetAzimuth,
      toElevation: this.targetElevation,
    }
    // Start the eased state at the far end so a cancelled flight does not snap.
    this.distance = travel
    this.mode = 'orbit'
  }

  /** Abandon a flight in progress, keeping wherever the camera has reached. */
  cancelFlight(): void {
    if (!this.flight) return
    this.flight = null
    this.adoptOrbitFromPosition()
    this.travelIntensity = 0
  }

  /** Re-derive azimuth, elevation and distance from the camera's position. */
  private adoptOrbitFromPosition(): void {
    const p = this.camera.position.clone().sub(this.panOffset)
    this.distance = Math.max(p.length(), 1e-4)
    this.targetDistance = this.distance
    this.azimuth = Math.atan2(p.y, p.x)
    this.targetAzimuth = this.azimuth
    this.elevation = Math.asin(Math.max(-1, Math.min(1, p.z / this.distance)))
    this.targetElevation = this.elevation
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

  /**
   * True while the camera is still easing toward its target. The frame governor
   * uses this to keep drawing at full rate through a fly-to, and to stop as soon
   * as the motion has actually settled.
   */
  get isSettling(): boolean {
    return (
      this.flight !== null ||
      Math.abs(this.distance - this.targetDistance) > this.targetDistance * 1e-4 ||
      Math.abs(this.azimuth - this.targetAzimuth) > 1e-4 ||
      Math.abs(this.elevation - this.targetElevation) > 1e-4 ||
      Math.abs(this.roll - this.targetRoll) > 1e-4
    )
  }

  /** performance.now() of the last real user input. */
  lastInputAt = -Infinity

  /** Distance from the focus surface, scene units (negative inside the body). */
  altitude(): number {
    if (!this._focus) return this.distance
    return this.distance - this._focus.sceneRadius
  }

  /** Orbit angles, exposed so the view can be written into a shareable URL. */
  get orbitAzimuth(): number {
    return this.azimuth
  }

  get orbitElevation(): number {
    return this.elevation
  }

  /** Distance from the focus centre in radii of the focused body. */
  get distanceInRadii(): number {
    const radius = this._focus?.sceneRadius ?? 0
    return radius > 0 ? this.distance / radius : 0
  }

  /**
   * Restore a view decoded from a URL, without animation.
   *
   * Distance arrives in radii of the focused body rather than scene units, so a
   * shared link frames the body the same way whether the recipient lands in
   * explore or true scale. Call after the focus is set and after the system has
   * been solved once, or `sceneRadius` will still hold the previous mode's value.
   */
  restoreView(view: { azimuth?: number; elevation?: number; distanceRadii?: number }): void {
    if (view.azimuth !== undefined && Number.isFinite(view.azimuth)) {
      this.azimuth = this.targetAzimuth = view.azimuth
    }
    if (view.elevation !== undefined && Number.isFinite(view.elevation)) {
      const clamped = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, view.elevation))
      this.elevation = this.targetElevation = clamped
    }
    if (view.distanceRadii !== undefined && view.distanceRadii > 0 && this._focus) {
      this.targetDistance = this._focus.sceneRadius * view.distanceRadii
      this.clampDistance()
      this.distance = this.targetDistance
    }
    this.mode = 'orbit'
    this.focusTransition = 1
  }

  /**
   * Free-flight position and orientation, for writing into a shareable link.
   *
   * Position comes back in radii of the focused body rather than scene units,
   * so a link frames its subject the same way whichever scale mode the
   * recipient lands in — the same reasoning as `distanceInRadii`. Orientation
   * is the raw quaternion: in free flight, where you are looking is independent
   * of where you are, so there is nothing else to derive it from.
   */
  freeView(): { position: [number, number, number]; orientation: [number, number, number, number] } | null {
    const radius = this._focus?.sceneRadius ?? 0
    if (this.mode !== 'free' || radius <= 0) return null
    const q = this.freeQuaternion
    return {
      position: [
        this.freePosition.x / radius,
        this.freePosition.y / radius,
        this.freePosition.z / radius,
      ],
      orientation: [q.x, q.y, q.z, q.w],
    }
  }

  /**
   * Put the camera back into free flight exactly where a link left it.
   *
   * Called after `restoreView`, which unconditionally selects orbit mode — a
   * shared link has to be able to say "and they were flying", or reloading the
   * page swings the camera back to face the focus and throws the view away.
   */
  restoreFreeView(view: {
    position: readonly [number, number, number]
    orientation?: readonly [number, number, number, number] | null
  }): void {
    const radius = this._focus?.sceneRadius ?? 0
    if (radius <= 0) return
    this.freePosition.set(
      view.position[0] * radius,
      view.position[1] * radius,
      view.position[2] * radius,
    )
    if (view.orientation) {
      const [x, y, z, w] = view.orientation
      this.freeQuaternion.set(x, y, z, w).normalize()
    }
    this.mode = 'free'
    this.camera.position.copy(this.freePosition)
    this.camera.quaternion.copy(this.freeQuaternion)
    // Keep the orbit state coherent so pressing V is not a jump.
    this.distance = Math.max(this.freePosition.length(), 1e-4)
    this.targetDistance = this.distance
    this.focusTransition = 1
  }

  // -- per-frame -----------------------------------------------------------

  update(dt: number): void {
    if (this.flight) this.updateFlight(dt)
    else if (this.mode === 'orbit') this.updateOrbit(dt)
    else this.updateFree(dt)
    this.updateProjection()
  }

  /**
   * One frame of a cinematic approach.
   *
   * Two curves, deliberately out of step. The orientation resolves early — a
   * front-loaded ease, so the camera has turned to face the destination within
   * the first third and you spend the rest of the trip watching it grow. The
   * position uses a slow-in/slow-out curve applied to the *logarithm* of the
   * distance, because at these scales a linear approach spends almost all its
   * time as an indistinguishable speck and then arrives all at once.
   */
  private updateFlight(dt: number): void {
    const f = this.flight!
    f.elapsed += dt
    const t = Math.min(1, f.elapsed / f.duration)

    const ease = t * t * (3 - 2 * t)
    // Turning finishes at a third of the way, then holds.
    const turn = Math.min(1, ease * 3)

    // Destination position in the same frame the flight started in.
    const cosE = Math.cos(f.toElevation)
    const to = new Vector3(
      f.toDistance * cosE * Math.cos(f.toAzimuth),
      f.toDistance * cosE * Math.sin(f.toAzimuth),
      f.toDistance * Math.sin(f.toElevation),
    )

    // Interpolate the direction on the sphere and the radius in log space, so
    // the crossing reads as steady progress rather than a sudden arrival.
    const fromLength = Math.max(f.fromPosition.length(), 1e-6)
    const toLength = Math.max(to.length(), 1e-6)
    const direction = f.fromPosition
      .clone()
      .normalize()
      .lerp(to.clone().normalize(), ease)
      .normalize()
    const radius = Math.exp(
      Math.log(fromLength) + (Math.log(toLength) - Math.log(fromLength)) * ease,
    )
    this.camera.position.copy(direction).multiplyScalar(radius).add(this.panOffset)

    // Orientation: from wherever we were looking, to facing the destination.
    this.camera.up.set(0, 0, 1)
    const aimed = new PerspectiveCamera()
    aimed.up.set(0, 0, 1)
    aimed.position.copy(this.camera.position)
    aimed.lookAt(this.panOffset)
    this.camera.quaternion.copy(f.fromQuaternion).slerp(aimed.quaternion, turn)

    // Fast in the middle, still at both ends — what the dust field reacts to.
    this.travelIntensity = Math.sin(Math.PI * t) ** 0.7

    this.distance = radius
    this.focusTransition = 1

    if (t >= 1) {
      this.flight = null
      this.travelIntensity = 0
      this.roll = 0
      this.targetRoll = 0
      this.adoptOrbitFromPosition()
      this.targetDistance = f.toDistance
      this.targetAzimuth = f.toAzimuth
      this.targetElevation = f.toElevation
    }
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

    // Q and E roll here as well as in free flight; they used to be ignored in
    // orbit mode, which made the horizon feel nailed down.
    const rollRate = 1.4 * dt * speed
    if (this.keys.rollLeft) this.targetRoll -= rollRate
    if (this.keys.rollRight) this.targetRoll += rollRate

    this.clampDistance()

    this.azimuth += (this.targetAzimuth - this.azimuth) * k
    this.elevation += (this.targetElevation - this.elevation) * k
    this.distance += (this.targetDistance - this.distance) * k
    this.roll += (this.targetRoll - this.roll) * k
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
    // Roll about the view axis, applied after the look, which has just
    // discarded any previous rotation. Negated because the camera's local +z
    // points *backward* along the view, so a positive rotation about it turns
    // the opposite way to free flight, which rolls about the forward vector.
    if (this.roll !== 0) this.camera.rotateZ(-this.roll)
    this.freePosition.copy(this.camera.position)
    this.freeQuaternion.copy(this.camera.quaternion)
  }

  private updateFree(dt: number): void {
    const boost = this.keys.boost ? 8 : this.keys.precise ? 0.12 : 1
    const step = this.freeFlightStep(dt, boost)

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

  /**
   * How far free flight moves this frame, derived from how much room there is.
   *
   * A fixed speed cannot serve both jobs at this scale. 200 units/s took six
   * minutes to cross from Earth to Mars, and was still fast enough to pass
   * straight through a planet on arrival. Scaling with the clearance to the
   * nearest surface gives one rule that does both: open space is fast, and the
   * approach decays geometrically.
   *
   * The step is capped at a fraction of the remaining gap as well as by speed,
   * and that cap is what actually prevents a collision. Speed alone does not:
   * a minimum speed has to exist so you can still manoeuvre when parked, and
   * that floor will happily carry you through the last few hundred kilometres
   * once the asymptote drops below it — measured at 940 m of penetration into
   * Earth before this cap existed.
   */
  private freeFlightStep(dt: number, boost: number): number {
    const clearance = Number.isFinite(this.nearestSurface)
      ? this.nearestSurface
      : Math.max(this.distance, 1)

    // Already inside something: damping would trap you there, so fly freely.
    if (clearance <= 0) return Math.max(MIN_FREE_SPEED, Math.abs(clearance)) * boost * dt

    const speed = Math.min(clearance * FREE_SPEED_PER_UNIT, MAX_FREE_SPEED)
    return Math.min(Math.max(speed, MIN_FREE_SPEED) * boost * dt, clearance * MAX_STEP_FRACTION)
  }

  /**
   * Distance to the nearest body's surface, scene units, in free flight.
   * Supplied per frame by the caller, which is the thing that owns the system.
   * Negative when the camera is inside a body.
   */
  private nearestSurface = Infinity

  setNearestSurface(distance: number): void {
    this.nearestSurface = distance
  }

  private rollFree(amount: number): void {
    const axis = new Vector3(0, 0, -1).applyQuaternion(this.freeQuaternion)
    this.freeQuaternion.premultiply(new Quaternion().setFromAxisAngle(axis, amount))
  }

  /**
   * Near and far planes derived from how much empty space is actually ahead.
   *
   * The scene spans eleven orders of magnitude, so fixed planes cannot work. We
   * pick a window around the camera each frame; combined with the logarithmic
   * depth buffer this keeps a spacecraft-scale foreground and a Neptune-scale
   * background in the same image without z-fighting.
   *
   * The window must come from the nearest *surface*, not from `distance`.
   * `distance` is measured to the focused body, which in orbit mode is the thing
   * you are looking at and in free flight is emphatically not: parked 102 units
   * off Mars with Earth still focused, `distance` reads 285,359, which put the
   * near plane at 2,852 — 28 times further away than the planet in front of the
   * camera. Mars fell entirely inside the near plane and was clipped out of
   * existence, and its label went with it, since projecting a point inside the
   * near plane culls it too. Flying between planets simply erased the
   * destination.
   *
   * Taking the smaller of the two references fixes that without disturbing
   * orbit mode, where the focus normally *is* the nearest surface and the two
   * agree. The clearance can also be negative, when the camera is inside a
   * body; the floor handles that, and a tiny near plane is what you want there
   * anyway so you can see back out.
   */
  private updateProjection(): void {
    const toFocusSurface = this._focus
      ? Math.max(this.distance - this._focus.sceneRadius, 1e-5)
      : this.distance
    const clearance = Number.isFinite(this.nearestSurface) ? this.nearestSurface : toFocusSurface
    const room = Math.max(Math.min(toFocusSurface, clearance), 1e-5)

    const near = Math.max(1e-5, Math.min(room * 0.02, this.distance * 0.01))
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
    // Capture is an optimisation, not a requirement: it keeps a drag alive when
    // the cursor leaves the canvas. It throws NotFoundError if the pointer is no
    // longer active — which a synthetic or already-released event can be — and an
    // uncaught throw here would abandon the rest of this handler, leaving
    // `dragging` unset so the drag silently never starts.
    try {
      this.element?.setPointerCapture?.(ev.pointerId)
    } catch {
      /* drag still works, it just stops if the cursor leaves the canvas */
    }
    // Touching the view takes control back; a flight that kept running would be
    // fighting the drag for the rest of its duration.
    this.cancelFlight()
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    this.lastPointer = { x: ev.clientX, y: ev.clientY }

    if (this.activePointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance()
      this.pinchCentre = this.currentPinchCentre()
      this.dragging = 'none'
      return
    }
    // Middle button, right button or shift-drag pans; anything else rotates.
    this.dragging = ev.button === 1 || ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit'
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.activePointers.has(ev.pointerId)) return
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })

    // Two fingers do both jobs at once, as they do on a map: the distance
    // between them zooms, and where their midpoint travels pans. Panning had no
    // touch gesture at all before — on desktop it is shift-drag or a second
    // mouse button, and a phone has neither.
    if (this.activePointers.size === 2) {
      const d = this.currentPinchDistance()
      const centre = this.currentPinchCentre()
      if (this.pinchDistance > 0 && d > 0) {
        this.zoomBy(this.pinchDistance / d)
        this.panByScreen(centre.x - this.pinchCentre.x, centre.y - this.pinchCentre.y)
        this.interacted = true
        this.lastInputAt = performance.now()
      }
      this.pinchDistance = d
      this.pinchCentre = centre
      return
    }

    const dx = ev.clientX - this.lastPointer.x
    const dy = ev.clientY - this.lastPointer.y
    this.lastPointer = { x: ev.clientX, y: ev.clientY }
    if (dx === 0 && dy === 0) return
    this.interacted = true
    this.lastInputAt = performance.now()

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
      this.panByScreen(dx, dy)
    }
  }

  /** Pan in the camera plane, scaled so the movement tracks the finger. */
  private panByScreen(dx: number, dy: number): void {
    const scale = this.distance * 0.0016
    const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0)
    const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1)
    this.panOffset.addScaledVector(right, -dx * scale)
    this.panOffset.addScaledVector(up, dy * scale)
  }

  private onPointerUp(ev: PointerEvent): void {
    this.activePointers.delete(ev.pointerId)
    if (this.activePointers.size < 2) this.pinchDistance = 0
    if (this.activePointers.size === 0) this.dragging = 'none'
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault()
    this.cancelFlight()
    this.interacted = true
    this.lastInputAt = performance.now()

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

  private currentPinchCentre(): { x: number; y: number } {
    const pts = [...this.activePointers.values()]
    if (pts.length < 2) return { x: 0, y: 0 }
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
  }
}
