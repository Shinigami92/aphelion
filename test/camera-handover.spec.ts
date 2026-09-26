/**
 * The camera changing hands: a flight interrupted by another command, and
 * the switches between orbiting and free flight.
 *
 * Each of these used to leave one mode's state behind for the other to trip
 * over — a flight that kept flying after Home, an orbit that resumed from
 * angles it had before V was pressed — so every test asserts where the camera
 * actually ends up rather than which flags are set. Pointer input goes through
 * a stand-in element, since `CameraInput` only ever calls `addEventListener`.
 */

import type { SimBody } from '../src/core/system.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { CameraController } from '../src/controls/camera.ts';
import { SolarSystem } from '../src/core/system.ts';
import { JD_TT, settledAt } from './system-fixture.ts';

const FRAME = 1 / 60;
/** Longer than the longest cinematic flight, which is capped at nine seconds. */
const OUTLAST_ANY_FLIGHT = 12 * 60;

let system: SolarSystem;

const body = (key: string): SimBody => {
  const found = system.byKey.get(key);
  if (!found) {
    throw new Error(`no body '${key}'`);
  }
  return found;
};

const run = (c: CameraController, frames: number): void => {
  for (let i = 0; i < frames; i++) {
    c.update(FRAME);
  }
};

const fresh = (): CameraController => {
  const c = new CameraController(16 / 9);
  c.setFocus(body('earth'), { immediate: true });
  c.update(FRAME);
  return c;
};

type Dispatch = (type: string, ev: Record<string, unknown>) => void;

/** Attach to a stand-in element and return a way to fire events at it. */
const attachFake = (c: CameraController): Dispatch => {
  const handlers = new Map<string, (ev: unknown) => void>();
  const element = {
    addEventListener: (type: string, handler: (ev: unknown) => void): void => {
      handlers.set(type, handler);
    },
    removeEventListener: (): void => {},
    setPointerCapture: (): void => {},
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CameraInput only adds and removes listeners and captures the pointer, and Node has no DOM
  c.attach(element as unknown as HTMLElement);
  return (type, ev) => {
    handlers.get(type)?.({ preventDefault: (): void => {}, button: 0, shiftKey: false, ...ev });
  };
};

beforeAll(() => {
  system = new SolarSystem();
  system.update(JD_TT, settledAt('explore'));
});

describe('interrupting a flight', () => {
  it('lets Home frame the system instead of arriving at the old destination', () => {
    const c = fresh();
    let arrived = 0;
    c.flyTo(body('jupiter'), {
      onArrive: () => {
        arrived++;
      },
    });
    run(c, 60);
    // What the Home key does.
    const sun = body('sun');
    c.setFocus(sun, { immediate: false });
    c.frameSystem(sun, 5000);
    expect(c.travelling).toBe(0);

    run(c, OUTLAST_ANY_FLIGHT);
    expect(arrived).toBe(0);
    expect(c.focus?.key).toBe('sun');
    expect(c.currentDistance / Math.max(sun.sceneRadius * 3, 5000 * 1.6)).toBeCloseTo(1, 4);
    expect(c.isSettling).toBe(false);
  });

  it('keeps a refocus made mid-flight', () => {
    const c = fresh();
    c.flyTo(body('mars'));
    run(c, 60);
    c.setFocus(body('venus'), { immediate: true });
    run(c, OUTLAST_ANY_FLIGHT);
    expect(c.focus?.key).toBe('venus');
    expect(c.distanceInRadii).toBeCloseTo(4.2, 4);
  });

  it('stops where it is when V switches to free flight', () => {
    const c = fresh();
    c.flyTo(body('jupiter'));
    run(c, 60);
    const reached = c.camera.position.clone();
    expect(c.toggleMode()).toBe('free');
    expect(c.travelling).toBe(0);
    expect(c.isSettling).toBe(false);
    run(c, OUTLAST_ANY_FLIGHT);
    expect(c.camera.position.distanceTo(reached)).toBeLessThan(reached.length() * 1e-9);
  });
});

describe('switching between orbit and free flight', () => {
  it('resumes orbiting from wherever free flight left the camera', () => {
    const c = fresh();
    c.toggleMode();
    c.setNearestSurface(c.altitude());
    c.keys.right = true;
    c.keys.up = true;
    run(c, 40);
    c.keys.right = false;
    c.keys.up = false;
    const parked = c.camera.position.clone();

    expect(c.toggleMode()).toBe('orbit');
    c.update(FRAME);
    expect(c.camera.position.distanceTo(parked)).toBeLessThan(parked.length() * 1e-6);
    // And it stays there: nothing is left over for the easing to close.
    expect(c.isSettling).toBe(false);
    run(c, 120);
    expect(c.camera.position.distanceTo(parked)).toBeLessThan(parked.length() * 1e-6);
  });

  it('does not count unfinished orbit easing as settling once in free flight', () => {
    const c = fresh();
    c.keys.orbitLeft = true;
    run(c, 10);
    c.keys.orbitLeft = false;
    expect(c.isSettling).toBe(true);
    c.toggleMode();
    c.update(FRAME);
    expect(c.isSettling).toBe(false);
  });
});

/** How far one frame of W carries the camera, from a fixed clearance. */
const forwardStep = (c: CameraController): number => {
  c.setNearestSurface(1000);
  const before = c.camera.position.clone();
  c.keys.forward = true;
  c.update(FRAME);
  c.keys.forward = false;
  return c.camera.position.distanceTo(before);
};

describe('the wheel and pinch in free flight', () => {
  it('scales the WASD speed, within its range, and announces it', () => {
    const plain = fresh();
    plain.toggleMode();
    const baseline = forwardStep(plain);

    const c = fresh();
    const fire = attachFake(c);
    const announced: number[] = [];
    c.onFreeSpeedChange = (factor): void => {
      announced.push(factor);
    };
    c.toggleMode();
    for (let notch = 0; notch < 5; notch++) {
      fire('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: false });
    }
    const factor = Math.exp(5 * 100 * 0.0016);
    expect(announced).toHaveLength(5);
    expect(announced.at(-1)).toBeCloseTo(factor, 9);
    expect(forwardStep(c) / baseline).toBeCloseTo(factor, 6);

    for (let notch = 0; notch < 100; notch++) {
      fire('wheel', { deltaY: 100, deltaMode: 0, ctrlKey: false });
    }
    expect(announced.at(-1)).toBe(1 / 64);
  });

  it('still zooms while orbiting', () => {
    const c = fresh();
    const fire = attachFake(c);
    let announced = 0;
    c.onFreeSpeedChange = (): void => {
      announced++;
    };
    const before = c.distanceInRadii;
    fire('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: false });
    run(c, 120);
    expect(c.distanceInRadii).toBeLessThan(before);
    expect(announced).toBe(0);
  });

  it('leaves the camera alone on a pinch, and on the way back to orbit', () => {
    const c = fresh();
    const fire = attachFake(c);
    c.toggleMode();
    c.update(FRAME);
    const parked = c.camera.position.clone();

    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    fire('pointermove', { pointerId: 2, clientX: 320, clientY: 160 });
    fire('pointerup', { pointerId: 2, clientX: 320, clientY: 160 });
    fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
    c.update(FRAME);
    expect(c.camera.position.distanceTo(parked)).toBeLessThan(parked.length() * 1e-9);

    c.toggleMode();
    run(c, 120);
    expect(c.camera.position.distanceTo(parked)).toBeLessThan(parked.length() * 1e-6);
  });
});
