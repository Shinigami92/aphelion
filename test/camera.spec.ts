/**
 * The camera controller, driven headless.
 *
 * It needs Three's maths but no WebGL and no DOM (only `attach()` touches an
 * element), so the whole state machine runs under Node: focusing, restoring a
 * shared view, keyboard orbiting and zoom, a full cinematic flight, a cancelled
 * one, free flight against a nearby surface, and the free-view round trip.
 *
 * Checkpoints are compared against a snapshot. The contract is "the camera does
 * exactly what it did", which is what a refactor of this file has to keep; the
 * few properties that are worth stating on their own are asserted directly.
 */

import type { SimBody } from '../src/core/system.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { jdUtcToTt, parseUtc } from '../src/astro/timescales.ts';
import { CameraController } from '../src/controls/camera.ts';
import { ScaleModel } from '../src/core/scale.ts';
import { SolarSystem } from '../src/core/system.ts';

const FRAME = 1 / 60;

/** Six significant figures: tight enough to catch a real change, loose enough to survive libm. */
const sig = (x: number): number => Number(x.toPrecision(6));

let system: SolarSystem;

const body = (key: string): SimBody => {
  const found = system.byKey.get(key);
  if (!found) {
    throw new Error(`no body '${key}'`);
  }
  return found;
};

/** Unit vector from a body toward the Sun, as the app passes it for daylit arrival. */
const sunward = (b: SimBody): { x: number; y: number; z: number } => {
  const r = Math.hypot(b.helioKm.x, b.helioKm.y, b.helioKm.z);
  return { x: -b.helioKm.x / r, y: -b.helioKm.y / r, z: -b.helioKm.z / r };
};

/** Everything observable about the camera, rounded. */
const pose = (c: CameraController): Record<string, unknown> => ({
  focus: c.focus?.key ?? null,
  mode: c.mode,
  position: [c.camera.position.x, c.camera.position.y, c.camera.position.z].map(sig),
  quaternion: [
    c.camera.quaternion.x,
    c.camera.quaternion.y,
    c.camera.quaternion.z,
    c.camera.quaternion.w,
  ].map(sig),
  near: sig(c.camera.near),
  far: sig(c.camera.far),
  distance: sig(c.currentDistance),
  azimuth: sig(c.orbitAzimuth),
  elevation: sig(c.orbitElevation),
  radii: sig(c.distanceInRadii),
  altitude: sig(c.altitude()),
  travelling: sig(c.travelling),
  settling: c.isSettling,
});

const run = (c: CameraController, frames: number): void => {
  for (let i = 0; i < frames; i++) {
    c.update(FRAME);
  }
};

const fresh = (): CameraController => {
  const c = new CameraController(16 / 9);
  const earth = body('earth');
  c.setFocus(earth, { immediate: true, arriveFrom: sunward(earth) });
  c.update(FRAME);
  return c;
};

beforeAll(() => {
  system = new SolarSystem();
  const scale = new ScaleModel();
  scale.setMode('explore');
  scale.snap();
  system.update(jdUtcToTt(parseUtc('2024-04-08 18:17:16') ?? Number.NaN), scale);
});

describe('orbit mode', () => {
  it('frames a planet at 4.2 radii on the daylit side, already settled', () => {
    const c = fresh();
    expect(c.distanceInRadii).toBeCloseTo(4.2, 6);
    expect(c.isSettling).toBe(false);
    expect(pose(c)).toMatchSnapshot();
  });

  it('restores a shared view exactly, with elevation clamped', () => {
    const c = fresh();
    c.restoreView({ azimuth: 2.5, elevation: 3, distanceRadii: 12 });
    c.update(FRAME);
    expect(c.orbitAzimuth).toBe(2.5);
    expect(c.orbitElevation).toBeCloseTo((89.5 * Math.PI) / 180, 12);
    expect(c.distanceInRadii).toBeCloseTo(12, 6);
    expect(pose(c)).toMatchSnapshot();
  });

  it('orbits, zooms and rolls from the keys, then eases to rest', () => {
    const c = fresh();
    c.keys.orbitLeft = true;
    c.keys.orbitUp = true;
    c.keys.zoomIn = true;
    c.keys.rollRight = true;
    run(c, 30);
    const moving = pose(c);
    c.keys.orbitLeft = false;
    c.keys.orbitUp = false;
    c.keys.zoomIn = false;
    c.keys.rollRight = false;
    run(c, 240);
    expect(c.isSettling).toBe(false);
    expect({ moving, rested: pose(c) }).toMatchSnapshot();
  });

  it('never zooms inside the body', () => {
    const c = fresh();
    c.keys.zoomIn = true;
    c.keys.boost = true;
    run(c, 600);
    expect(c.altitude()).toBeGreaterThan(0);
    expect(c.distanceInRadii).toBeCloseTo(1.02, 3);
  });

  it('frames a whole system from above', () => {
    const c = fresh();
    c.frameSystem(body('sun'), 5000);
    run(c, 120);
    expect(c.focus?.key).toBe('sun');
    expect(pose(c)).toMatchSnapshot();
  });
});

describe('cinematic flight', () => {
  it('switches focus at once, travels, and arrives framed', () => {
    const c = fresh();
    const mars = body('mars');
    let arrived = 0;
    c.flyTo(mars, {
      arriveFrom: sunward(mars),
      onArrive: () => {
        arrived++;
      },
    });
    expect(c.focus?.key).toBe('mars');
    expect(c.isSettling).toBe(true);

    const checkpoints: Array<Record<string, unknown>> = [];
    // Twelve seconds of flight, sampled every one and a half.
    for (let checkpoint = 0; checkpoint < 8; checkpoint++) {
      run(c, 90);
      checkpoints.push(pose(c));
    }
    expect(arrived).toBe(1);
    expect(c.travelling).toBe(0);
    expect(c.distanceInRadii).toBeCloseTo(4.2, 3);
    expect(checkpoints).toMatchSnapshot();
  });

  it('keeps wherever it had reached when cancelled, and never fires onArrive', () => {
    const c = fresh();
    let arrived = 0;
    c.flyTo(body('jupiter'), {
      onArrive: () => {
        arrived++;
      },
    });
    run(c, 120);
    const before = pose(c);
    c.cancelFlight();
    c.update(FRAME);
    run(c, 600);
    expect(arrived).toBe(0);
    expect({ before, after: pose(c) }).toMatchSnapshot();
  });

  it('eases rather than flies when the destination is already framed', () => {
    const c = fresh();
    let arrived = 0;
    c.flyTo(body('earth'), {
      onArrive: () => {
        arrived++;
      },
    });
    expect(arrived).toBe(1);
    run(c, 10);
    expect(c.travelling).toBe(0);
  });
});

describe('free flight', () => {
  it('toggles, moves by the clearance ahead, rolls, and aims back at the focus', () => {
    const c = fresh();
    expect(c.toggleMode()).toBe('free');
    c.setNearestSurface(c.altitude());
    c.keys.forward = true;
    c.keys.rollLeft = true;
    run(c, 60);
    const flying = pose(c);
    c.keys.forward = false;
    c.keys.rollLeft = false;
    c.lookAtFocus();
    c.update(FRAME);
    expect({ flying, aimed: pose(c) }).toMatchSnapshot();
    expect(c.toggleMode()).toBe('orbit');
  });

  it('closes at most a fixed fraction of the gap per frame, however hard it is boosted', () => {
    const c = fresh();
    c.toggleMode();
    const gap = c.altitude();
    c.setNearestSurface(gap);
    c.keys.forward = true;
    c.keys.boost = true;
    const before = c.camera.position.clone();
    c.update(FRAME);
    expect(c.camera.position.distanceTo(before)).toBeLessThanOrEqual(gap * 0.35 + 1e-9);
  });

  it('round-trips through a shared free view', () => {
    const c = fresh();
    c.toggleMode();
    c.setNearestSurface(c.altitude());
    c.keys.right = true;
    run(c, 20);
    c.keys.right = false;
    const view = c.freeView()!;

    const other = fresh();
    other.restoreFreeView(view);
    other.update(FRAME);
    expect(other.mode).toBe('free');
    expect(other.camera.position.distanceTo(c.camera.position)).toBeLessThan(1e-6);
    expect(other.freeView()).toEqual(view);
  });

  it('has no free view to share while orbiting', () => {
    expect(fresh().freeView()).toBeNull();
  });
});
