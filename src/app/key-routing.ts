/**
 * Who a key press is for: the element it landed on, the browser, or the app.
 *
 * Kept free of the DOM so the rules can be tested on their own; `keyboard.ts`
 * describes the event's target and asks here.
 */

/**
 * What a key event landed on, as far as routing cares: the page itself (the
 * body or the canvas), a text field, a slider, or any other focused control.
 */
export type KeyTarget = 'page' | 'text' | 'slider' | 'control';

/** The parts of a keyboard event the routing reads. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  /** AltGr, which Windows reports as Ctrl+Alt. */
  altGraph: boolean;
}

/** The keys a focused range slider answers itself. */
const SLIDER_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Shortcuts that keep acting while their key is held. They step the rate or
 * the clock, where holding to keep stepping is the point; every other
 * shortcut toggles or jumps, and repeating one flickers it on and off.
 */
const REPEATING_SHORTCUTS: ReadonlySet<string> = new Set(['[', ']', '.', ',']);

/** Whether the app should act on this key at all, rather than leave it to the page. */
export function appHandlesKey(press: KeyPress, target: KeyTarget): boolean {
  if (target === 'text') {
    return false;
  }
  // A slider that has just been dragged keeps focus, and it would be odd for
  // every shortcut to stop working until something else is clicked. It only
  // keeps the keys that move its thumb.
  if (target === 'slider' && SLIDER_KEYS.has(press.key)) {
    return false;
  }
  // Tab cycles the planets only when nothing else has focus. Anywhere else it
  // is how a keyboard user moves between the controls.
  if (press.key === 'Tab' && target !== 'page') {
    return false;
  }
  // Ctrl and Cmd chords are the browser's: Ctrl+0 resets the zoom, Ctrl+P
  // prints. AltGr arrives with Ctrl set on Windows, and it is how German and
  // many other layouts type `[` and `]`, so it does not count as a chord.
  return !((press.ctrlKey || press.metaKey) && !press.altGraph);
}

/** Whether a held key should keep firing its shortcut. */
export function shortcutRepeats(key: string): boolean {
  return REPEATING_SHORTCUTS.has(key);
}
