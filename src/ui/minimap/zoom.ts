/** Wheel and pinch zoom for the mini-map. */

export class MinimapZoom {
  /** Multiplier on the span fitted to the system; above 1 is zoomed out. */
  bias = 1;

  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  /** When a pinch last moved, so the click it ends with can be ignored. */
  private pinchedAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.setBias(this.bias * Math.exp(ev.deltaY * 0.0012));
    });

    // Pinch to zoom the map. Without this the map had no touch zoom at all, and
    // — worse — no `touch-action`, so a pinch fell through to the browser and
    // zoomed the entire page. iOS has ignored `user-scalable=no` since iOS 10,
    // so declaring the gesture ours in CSS is the only way to keep it.
    canvas.addEventListener('pointerdown', (ev) => {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) {
        this.pinchDistance = this.pinchSpan();
      }
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (!this.pointers.has(ev.pointerId)) {
        return;
      }
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size !== 2) {
        return;
      }
      const d = this.pinchSpan();
      if (this.pinchDistance > 0 && d > 0) {
        this.setBias(this.bias * (this.pinchDistance / d));
        this.pinchedAt = performance.now();
      }
      this.pinchDistance = d;
    });

    const release = (ev: PointerEvent): void => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) {
        this.pinchDistance = 0;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  /**
   * Whether a click is the end of a pinch rather than a tap. A pinch ends with
   * a click from the last finger lifted; without this the gesture would also
   * select whatever happened to be under it.
   */
  endsPinch(): boolean {
    return performance.now() - this.pinchedAt < 400;
  }

  private setBias(value: number): void {
    this.bias = Math.max(0.05, Math.min(8, value));
  }

  private pinchSpan(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) {
      return 0;
    }
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
