/** Clicking and tapping bodies on the canvas: a click selects, a double-click flies there. */

import type { SimBody } from '../core/system.ts';

/** Whether each tap completes a double-tap with the one before it. */
function doubleTapDetector(): (ev: PointerEvent) => boolean {
  /** Where and when the last tap landed, for reconstructing a double-tap. */
  let lastTapAt = { x: 0, y: 0, t: 0 };
  return (ev) => {
    const now = performance.now();
    const nearLast = Math.hypot(ev.clientX - lastTapAt.x, ev.clientY - lastTapAt.y) < 28;
    if (nearLast && now - lastTapAt.t < 320) {
      // Reset rather than record, so a third tap does not chain into a second
      // flight.
      lastTapAt = { x: 0, y: 0, t: 0 };
      return true;
    }
    lastTapAt = { x: ev.clientX, y: ev.clientY, t: now };
    return false;
  };
}

interface PointerDown {
  x: number;
  y: number;
  t: number;
}

/**
 * Which pointer releases are taps: short, still, and alone on the canvas. A
 * pinch ends with each finger lifting close to where it landed, which would
 * otherwise read as a tap and select whatever was under it.
 */
function tapTracker(): {
  down: (ev: PointerEvent) => void;
  /** Whether lifting this pointer ends a tap. */
  up: (ev: PointerEvent) => boolean;
} {
  const downs = new Map<number, PointerDown>();
  /** Whether the gesture under way has had two pointers down at once. */
  let multiTouch = false;
  return {
    down: (ev): void => {
      // A primary pointer only goes down when no other of its kind is, so
      // anything still recorded missed its pointerup and must not keep the
      // next tap from counting.
      if (ev.isPrimary) {
        downs.clear();
        multiTouch = false;
      }
      downs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (downs.size > 1) {
        multiTouch = true;
      }
    },
    up: (ev): boolean => {
      const down = downs.get(ev.pointerId);
      downs.delete(ev.pointerId);
      const alone = !multiTouch;
      if (downs.size === 0) {
        multiTouch = false;
      }
      if (!down || !alone) {
        return false;
      }
      // Only a pointer that basically stayed put makes a tap.
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      return moved <= 6 && performance.now() - down.t <= 500;
    },
  };
}

export function installPointerSelection(
  canvas: HTMLCanvasElement,
  pick: (x: number, y: number) => SimBody | null,
  select: (body: SimBody) => void,
  goTo: (body: SimBody) => void,
): void {
  const pickAt = (ev: MouseEvent): SimBody | null => {
    const rect = canvas.getBoundingClientRect();
    return pick(ev.clientX - rect.left, ev.clientY - rect.top);
  };
  const taps = tapTracker();
  canvas.addEventListener('pointerdown', (ev) => {
    taps.down(ev);
  });
  canvas.addEventListener('pointercancel', (ev) => {
    taps.up(ev);
  });

  const isDoubleTap = doubleTapDetector();

  canvas.addEventListener('pointerup', (ev) => {
    if (!taps.up(ev)) {
      return;
    }
    const hit = pickAt(ev);
    if (hit) {
      select(hit);
    }

    // Double-tap to fly to a body. A mouse keeps the native `dblclick` below;
    // touch does not raise one dependably, so it is reconstructed here — with a
    // looser radius than the 6px tap threshold, because two taps from the same
    // finger rarely land on the same pixel.
    if (ev.pointerType === 'mouse') {
      return;
    }
    if (isDoubleTap(ev) && hit) {
      goTo(hit);
    }
  });

  canvas.addEventListener('dblclick', (ev) => {
    const hit = pickAt(ev);
    if (hit) {
      select(hit);
      goTo(hit);
    }
  });
}
