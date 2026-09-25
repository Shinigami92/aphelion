/** Clicking and tapping bodies on the canvas: a click selects, a double-click flies there. */

import type { SimBody } from '../core/system.ts';

export function installPointerSelection(
  canvas: HTMLCanvasElement,
  pick: (x: number, y: number) => SimBody | null,
  select: (body: SimBody) => void,
  goTo: (body: SimBody) => void,
): void {
  let pointerDownAt = { x: 0, y: 0, t: 0 };

  canvas.addEventListener('pointerdown', (ev) => {
    pointerDownAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  });

  /** Where and when the last tap landed, for reconstructing a double-tap. */
  let lastTapAt = { x: 0, y: 0, t: 0 };

  canvas.addEventListener('pointerup', (ev) => {
    const moved = Math.hypot(ev.clientX - pointerDownAt.x, ev.clientY - pointerDownAt.y);
    const elapsed = performance.now() - pointerDownAt.t;
    // Only treat it as a click if the pointer basically stayed put.
    if (moved > 6 || elapsed > 500) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = pick(ev.clientX - rect.left, ev.clientY - rect.top);
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
    const now = performance.now();
    const nearLast = Math.hypot(ev.clientX - lastTapAt.x, ev.clientY - lastTapAt.y) < 28;
    if (nearLast && now - lastTapAt.t < 320) {
      if (hit) {
        goTo(hit);
      }
      // Reset rather than record, so a third tap does not chain into a second
      // flight.
      lastTapAt = { x: 0, y: 0, t: 0 };
    } else {
      lastTapAt = { x: ev.clientX, y: ev.clientY, t: now };
    }
  });

  canvas.addEventListener('dblclick', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const hit = pick(ev.clientX - rect.left, ev.clientY - rect.top);
    if (hit) {
      select(hit);
      goTo(hit);
    }
  });
}
