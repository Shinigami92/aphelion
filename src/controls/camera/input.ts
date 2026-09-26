/** Pointer, touch and wheel input: drag to look, pinch or wheel to zoom, modifier-drag to pan. */

import type { CameraState } from './state.ts';
import { lookBy, scaleFreeSpeed } from './free.ts';
import { MAX_ELEVATION } from './math.ts';
import { cancelFlight, panByScreen, zoomBy } from './orbit.ts';

export class CameraInput {
  private dragging: 'none' | 'orbit' | 'pan' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  /** Midpoint of a two-finger gesture, which pans as it travels. */
  private pinchCentre = { x: 0, y: 0 };

  private element: HTMLElement | null = null;
  private detachers: Array<() => void> = [];

  constructor(
    private readonly s: CameraState,
    /** Told the new setting whenever the wheel changes free-flight speed. */
    private readonly onFreeSpeed: (factor: number) => void,
  ) {}

  attach(element: HTMLElement): void {
    this.element = element;
    const add = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      element.addEventListener(type, handler, opts);
      this.detachers.push(() => {
        element.removeEventListener(type, handler);
      });
    };

    add('pointerdown', (ev) => {
      this.onPointerDown(ev);
    });
    add('pointermove', (ev) => {
      this.onPointerMove(ev);
    });
    add('pointerup', (ev) => {
      this.onPointerUp(ev);
    });
    add('pointercancel', (ev) => {
      this.onPointerUp(ev);
    });
    add(
      'wheel',
      (ev) => {
        this.onWheel(ev);
      },
      { passive: false },
    );
    add('contextmenu', (ev) => {
      ev.preventDefault();
    });
  }

  detach(): void {
    for (const off of this.detachers) {
      off();
    }
    this.detachers = [];
    this.element = null;
  }

  private onPointerDown(ev: PointerEvent): void {
    // Capture is an optimisation, not a requirement: it keeps a drag alive when
    // the cursor leaves the canvas. It throws NotFoundError if the pointer is no
    // longer active — which a synthetic or already-released event can be — and an
    // uncaught throw here would abandon the rest of this handler, leaving
    // `dragging` unset so the drag silently never starts.
    try {
      this.element?.setPointerCapture?.(ev.pointerId);
    } catch {
      /* drag still works, it just stops if the cursor leaves the canvas */
    }
    // Touching the view takes control back; a flight that kept running would be
    // fighting the drag for the rest of its duration.
    cancelFlight(this.s);
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.lastPointer = { x: ev.clientX, y: ev.clientY };

    if (this.activePointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance();
      this.pinchCentre = this.currentPinchCentre();
      this.dragging = 'none';
      return;
    }
    // Middle button, right button or shift-drag pans; anything else rotates.
    this.dragging = ev.button === 1 || ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit';
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.activePointers.has(ev.pointerId)) {
      return;
    }
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    // Two fingers do both jobs at once, as they do on a map: the distance
    // between them zooms, and where their midpoint travels pans. Panning had no
    // touch gesture at all before — on desktop it is shift-drag or a second
    // mouse button, and a phone has neither.
    if (this.activePointers.size === 2) {
      this.pinchMove();
      return;
    }

    const dx = ev.clientX - this.lastPointer.x;
    const dy = ev.clientY - this.lastPointer.y;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    if (dx === 0 && dy === 0) {
      return;
    }
    this.s.interacted = true;
    this.s.lastInputAt = performance.now();

    if (this.s.mode === 'free') {
      if (this.dragging === 'none') {
        return;
      }
      lookBy(this.s, dx * 0.0026, dy * 0.0026);
      return;
    }

    if (this.dragging === 'orbit') {
      this.s.targetAzimuth -= dx * 0.005;
      this.s.targetElevation = Math.max(
        -MAX_ELEVATION,
        Math.min(MAX_ELEVATION, this.s.targetElevation + dy * 0.005),
      );
    } else if (this.dragging === 'pan') {
      panByScreen(this.s, dx, dy);
    }
  }

  /** Zoom by how far the two fingers spread, and pan by how far their midpoint moved. */
  private pinchMove(): void {
    const d = this.currentPinchDistance();
    const centre = this.currentPinchCentre();
    // Zoom and pan are orbit-mode ideas. In free flight they only moved the
    // orbit state, which free flight overwrites every frame, so a pinch did
    // nothing visible until V was pressed — and then the camera jumped.
    if (this.s.mode === 'orbit' && this.pinchDistance > 0 && d > 0) {
      zoomBy(this.s, this.pinchDistance / d);
      panByScreen(this.s, centre.x - this.pinchCentre.x, centre.y - this.pinchCentre.y);
      this.s.interacted = true;
      this.s.lastInputAt = performance.now();
    }
    this.pinchDistance = d;
    this.pinchCentre = centre;
  }

  private onPointerUp(ev: PointerEvent): void {
    this.activePointers.delete(ev.pointerId);
    if (this.activePointers.size < 2) {
      this.pinchDistance = 0;
    }
    if (this.activePointers.size === 0) {
      this.dragging = 'none';
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    cancelFlight(this.s);
    this.s.interacted = true;
    this.s.lastInputAt = performance.now();

    // A trackpad pinch arrives as a wheel event with ctrlKey set; plain
    // two-finger scrolling arrives as small deltas. Both should zoom, but at
    // different sensitivities or pinching feels sluggish.
    const pinch = ev.ctrlKey;
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
    const delta = ev.deltaY * unit;
    const sensitivity = pinch ? 0.012 : 0.0016;

    // In free flight the wheel sets how fast WASD flies: away from you to
    // speed up, the way it zooms in while orbiting.
    if (this.s.mode === 'free') {
      this.onFreeSpeed(scaleFreeSpeed(this.s, Math.exp(-delta * sensitivity)));
      return;
    }
    zoomBy(this.s, Math.exp(delta * sensitivity));
  }

  private currentPinchDistance(): number {
    const pts = [...this.activePointers.values()];
    if (pts.length < 2) {
      return 0;
    }
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private currentPinchCentre(): { x: number; y: number } {
    const pts = [...this.activePointers.values()];
    if (pts.length < 2) {
      return { x: 0, y: 0 };
    }
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
}
