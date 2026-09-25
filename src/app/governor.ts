/** The frame governor: full rate while something moves, a trickle while nothing does. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';

/**
 * How often we actually redraw.
 *
 * The scene is never GPU-bound — it holds the vsync ceiling even at Retina
 * resolution with bloom, atmospheres and 75,000 belt points. The cost is that it
 * was drawing *every* frame the display offered, which on a 120 Hz panel meant
 * 120 full-quality renders a second whether or not anything had changed. Sitting
 * still with the clock at one second per second, consecutive frames are
 * identical, and all that work does is heat the machine and compete with
 * anything else wanting the GPU — a video call, for instance.
 *
 * So: 60 fps while something is actually happening, 10 while nothing is. Input
 * is checked before the throttle, so the first frame after you touch anything is
 * never delayed and the app stays responsive.
 */
const ACTIVE_FPS = 60;
const IDLE_FPS = 10;
/** Keep drawing at full rate for this long after the last input. */
const ACTIVE_LINGER_MS = 900;
/**
 * Above this time rate the scene visibly moves on its own, so idling would look
 * like stutter rather than stillness. One hour per second moves Earth about
 0.04 degrees along its orbit per frame at 10 fps.
 */
const MOVING_RATE = 3600;

export class FrameGovernor {
  private lastRenderAt = -Infinity;
  private pendingDt = 0;
  private lastInteractionAt = performance.now();
  private wasChanging = true;

  constructor(
    private readonly time: TimeController,
    private readonly scale: ScaleModel,
    private readonly camera: CameraController,
    private readonly scene: SceneView,
  ) {}

  /** Anything that should wake the renderer up. */
  markActive(): void {
    this.lastInteractionAt = performance.now();
  }

  /** Listen for the input the camera never sees, as well as the input it does. */
  install(canvas: HTMLCanvasElement): void {
    const wake = (): void => {
      this.markActive();
    };
    // Pointer and wheel events reach the camera, but the governor needs to know
    // about them too, and about the ones the camera never sees. Pointer-down is
    // window-wide so that clicking a checkbox or a body in the sidebar wakes the
    // renderer just as readily as dragging the sky; drag and zoom stay on the canvas
    // so that merely sweeping the cursor across a panel does not.
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    window.addEventListener('resize', wake);
    canvas.addEventListener('pointermove', wake, { passive: true });
    canvas.addEventListener('wheel', wake, { passive: true });
  }

  /**
   * Account for a display frame of `dt` seconds. Returns the simulated step to
   * draw with, or null when this frame should be skipped.
   */
  tick(now: number, dt: number): number | null {
    // Accumulate real time even on frames we skip, so the clock stays exact and
    // every easing term still receives the true elapsed interval.
    this.pendingDt += dt;

    const changing = this.sceneIsChanging(now);
    // Waking from idle draws on the very next display frame instead of waiting out
    // an active-rate interval, so touching anything responds immediately rather
    // than up to 17 ms later.
    if (changing && !this.wasChanging) {
      this.lastRenderAt = -Infinity;
    }
    this.wasChanging = changing;

    const interval = 1000 / (changing ? ACTIVE_FPS : IDLE_FPS);
    // Half a millisecond of slack, or a 60 fps target quietly becomes 30 on a
    // 120 Hz display when a frame lands a hair early.
    if (now - this.lastRenderAt < interval - 0.5) {
      return null;
    }
    this.lastRenderAt = now;

    const step = this.pendingDt;
    this.pendingDt = 0;
    return step;
  }

  private sceneIsChanging(now: number): boolean {
    if (now - this.lastInteractionAt < ACTIVE_LINGER_MS) {
      return true;
    }
    if (now - this.camera.lastInputAt < ACTIVE_LINGER_MS) {
      return true;
    }
    if (this.scale.isTransitioning || this.camera.isSettling) {
      return true;
    }
    if (!this.time.paused && Math.abs(this.time.selectedRate) >= MOVING_RATE) {
      return true;
    }
    // Ring particles tumble and shear at any running rate, including the slowest,
    // where no planet moves enough to wake the renderer on its own.
    if (!this.time.paused && this.scene.ringParticlesActive) {
      return true;
    }
    return false;
  }
}
