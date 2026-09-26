import type { KeyPress, KeyTarget } from '../src/app/key-routing.ts';
import { describe, expect, it } from 'vitest';
import { appHandlesKey, shortcutRepeats } from '../src/app/key-routing.ts';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altGraph: false,
  ...mods,
});

describe('which keys the app takes', () => {
  it('takes plain keys on the page, and none while typing', () => {
    expect(appHandlesKey(press('t'), 'page')).toBe(true);
    expect(appHandlesKey(press(' '), 'control')).toBe(true);
    expect(appHandlesKey(press('t'), 'text')).toBe(false);
    expect(appHandlesKey(press('Escape'), 'text')).toBe(false);
  });

  it('leaves Ctrl and Cmd chords to the browser', () => {
    for (const key of ['0', 'p', '=', '-', 'w', 'Tab']) {
      expect(appHandlesKey(press(key, { ctrlKey: true }), 'page')).toBe(false);
      expect(appHandlesKey(press(key, { metaKey: true }), 'page')).toBe(false);
    }
  });

  it('still takes brackets typed with AltGr, which Windows reports as Ctrl', () => {
    expect(appHandlesKey(press('[', { ctrlKey: true, altGraph: true }), 'page')).toBe(true);
    expect(appHandlesKey(press(']', { ctrlKey: true, altGraph: true }), 'page')).toBe(true);
  });

  it('lets a focused slider keep the keys that move it, and nothing else', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageDown']) {
      expect(appHandlesKey(press(key), 'slider')).toBe(false);
    }
    for (const key of [' ', 't', 'v', '[', 'w']) {
      expect(appHandlesKey(press(key), 'slider')).toBe(true);
    }
  });

  it('only cycles planets with Tab when nothing else has focus', () => {
    const targets: KeyTarget[] = ['control', 'slider', 'text'];
    for (const target of targets) {
      expect(appHandlesKey(press('Tab'), target)).toBe(false);
    }
    expect(appHandlesKey(press('Tab'), 'page')).toBe(true);
  });
});

describe('held keys', () => {
  it('repeat the stepping shortcuts and none of the toggles', () => {
    for (const key of ['[', ']', '.', ',']) {
      expect(shortcutRepeats(key)).toBe(true);
    }
    for (const key of [' ', 't', 'v', 'p', 'o', 'Tab', 'Home', '3']) {
      expect(shortcutRepeats(key)).toBe(false);
    }
  });
});
