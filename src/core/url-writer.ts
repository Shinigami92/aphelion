/** Keeping the address bar in step with the view. */

import type { SharedView } from './url-state.ts';
import { encodeView } from './url-state.ts';
// ---------------------------------------------------------------------------

/**
 * Keeps the address bar in step with the view, cheaply.
 *
 * Rebuilding and writing the URL every frame would be wasteful at 120 fps, so
 * this rebuilds at most every `intervalMs` and only touches history when the
 * string actually changed.
 */
export class UrlWriter {
  private lastQuery: string | null = null;
  private lastWriteAt = -Infinity;

  private intervalMs: number;

  // Written out rather than as a constructor parameter property: `pnpm validate`
  // runs this module under Node's type-stripping, which does not support them.
  constructor(intervalMs = 400) {
    this.intervalMs = intervalMs;
  }

  /** Call once per frame with a lazily-evaluated snapshot. */
  sync(nowMs: number, snapshot: () => SharedView): void {
    if (nowMs - this.lastWriteAt < this.intervalMs) {
      return;
    }
    this.lastWriteAt = nowMs;

    const query = encodeView(snapshot());
    if (query === this.lastQuery) {
      return;
    }
    this.lastQuery = query;

    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  /** Write immediately, ignoring the throttle (used right after a jump). */
  flush(snapshot: () => SharedView): void {
    this.lastWriteAt = -Infinity;
    this.sync(Number.POSITIVE_INFINITY, snapshot);
  }
}
