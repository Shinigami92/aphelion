/**
 * More than one finger on the canvas: a pinch must not read as a tap, and a
 * third finger must not make the camera jump. Both listen through stand-in
 * elements, since they only ever add listeners and read the bounding box.
 */

import type { SimBody } from '../src/core/system.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { installPointerSelection } from '../src/app/pointer.ts';
import { CameraController } from '../src/controls/camera.ts';
import { SolarSystem } from '../src/core/system.ts';
import { JD_TT, settledAt } from './system-fixture.ts';

type Dispatch = (type: string, ev: Record<string, unknown>) => void;

/** A stand-in element that records its listeners, and a way to fire events at it. */
const fakeElement = (): { element: unknown; fire: Dispatch } => {
  const handlers = new Map<string, Array<(ev: unknown) => void>>();
  const element = {
    addEventListener: (type: string, handler: (ev: unknown) => void): void => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    removeEventListener: (): void => {},
    setPointerCapture: (): void => {},
    getBoundingClientRect: (): { left: number; top: number } => ({ left: 0, top: 0 }),
  };
  const fire: Dispatch = (type, ev) => {
    const event = {
      preventDefault: (): void => {},
      button: 0,
      shiftKey: false,
      isPrimary: false,
      pointerType: 'touch',
      ...ev,
    };
    for (const handler of handlers.get(type) ?? []) {
      handler(event);
    }
  };
  return { element, fire };
};

let system: SolarSystem;

const body = (key: string): SimBody => {
  const found = system.byKey.get(key);
  if (!found) {
    throw new Error(`no body '${key}'`);
  }
  return found;
};

beforeAll(() => {
  system = new SolarSystem();
  system.update(JD_TT, settledAt('explore'));
});

/** Selection wired to a stand-in canvas, with every body it picks recorded. */
const install = (): { fire: Dispatch; selected: string[] } => {
  const { element, fire } = fakeElement();
  const selected: string[] = [];
  installPointerSelection(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the selection only adds listeners and reads the bounding box, and Node has no DOM
    element as HTMLCanvasElement,
    () => body('earth'),
    (hit) => {
      selected.push(hit.key);
    },
    () => {},
  );
  return { fire, selected };
};

describe('tapping bodies', () => {
  it('selects on a lone tap', () => {
    const { fire, selected } = install();
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerup', { pointerId: 1, clientX: 101, clientY: 100 });
    expect(selected).toEqual(['earth']);
  });

  it('does not select when a pinch lifts its fingers where they landed', () => {
    const { fire, selected } = install();
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    fire('pointerup', { pointerId: 2, clientX: 200, clientY: 100 });
    fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
    expect(selected).toEqual([]);

    // The next lone tap counts again.
    fire('pointerdown', { pointerId: 3, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerup', { pointerId: 3, clientX: 100, clientY: 100 });
    expect(selected).toEqual(['earth']);
  });

  it('is not blocked by a pointer whose release never arrived', () => {
    const { fire, selected } = install();
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerup', { pointerId: 2, clientX: 100, clientY: 100 });
    expect(selected).toEqual(['earth']);
  });
});

describe('three fingers on the camera', () => {
  it('leave the orbit angles alone while the first two pinch', () => {
    const c = new CameraController(16 / 9);
    c.setFocus(body('earth'), { immediate: true });
    const { element, fire } = fakeElement();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CameraInput only adds and removes listeners and captures the pointer, and Node has no DOM
    c.attach(element as HTMLElement);
    c.update(1 / 60);
    const azimuth = c.orbitAzimuth;
    const elevation = c.orbitElevation;
    const distance = c.distanceInRadii;

    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true });
    fire('pointerdown', { pointerId: 2, clientX: 300, clientY: 100 });
    fire('pointerdown', { pointerId: 3, clientX: 200, clientY: 300 });
    fire('pointermove', { pointerId: 3, clientX: 205, clientY: 300 });
    fire('pointermove', { pointerId: 1, clientX: 50, clientY: 100 });
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60);
    }

    expect(c.orbitAzimuth).toBeCloseTo(azimuth, 9);
    expect(c.orbitElevation).toBeCloseTo(elevation, 9);
    // The first two spread from 200 px to 250 px apart, which zooms in.
    expect(c.distanceInRadii / distance).toBeCloseTo(200 / 250, 3);
  });
});
