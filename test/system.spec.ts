/**
 * The simulated body tree.
 *
 * `pnpm validate` owns the accuracy checks against real ephemerides; this file
 * pins down the structure and the invariants the renderer leans on, so the
 * module can be split without anyone having to re-derive them:
 *
 *   - the tree is built once, parents before children, with stable keys;
 *   - Lagrange points are reachable by key but stay out of `bodies`;
 *   - the scale remap moves bodies radially and never changes a direction;
 *   - a golden snapshot of representative positions catches any silent drift.
 */

import type { Vec3 } from '../src/astro/kepler.ts';
import type { SimBody } from '../src/core/system.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { jdUtcToTt, parseUtc } from '../src/astro/timescales.ts';
import { AU_KM, GM } from '../src/core/constants.ts';
import { ScaleModel } from '../src/core/scale.ts';
import { escapeVelocity, hillRadius, SolarSystem } from '../src/core/system.ts';
import { DWARF_PLANETS, PLANETS } from '../src/data/bodies.ts';

// NaN rather than a cast: should the fixture ever stop parsing, every
// comparison against it fails instead of quietly testing `null`.
const JD_TT = jdUtcToTt(parseUtc('2024-04-08 18:17:16') ?? Number.NaN);

const settledAt = (mode: 'true' | 'explore'): ScaleModel => {
  const s = new ScaleModel();
  s.setMode(mode);
  s.snap();
  return s;
};

const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

const unit = (v: Vec3): Vec3 => {
  const r = length(v);
  return { x: v.x / r, y: v.y / r, z: v.z / r };
};

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/**
 * Radians. `acos` near 1 cannot resolve much below sqrt(epsilon), about 1.5e-8,
 * so a truly parallel pair still reads a few times that; a real sideways shift
 * would be orders of magnitude larger.
 */
const RADIAL_TOLERANCE = 1e-6;

const angleBetween = (a: Vec3, b: Vec3): number => {
  const ua = unit(a);
  const ub = unit(b);
  return Math.acos(Math.min(1, Math.max(-1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z)));
};

/** Six significant figures: tight enough to catch a real change, loose enough to survive libm. */
const sig = (x: number): number => Number(x.toPrecision(6));
const sigVec = (v: Vec3): [number, number, number] => [sig(v.x), sig(v.y), sig(v.z)];

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
});

describe('construction', () => {
  it('roots every body at the Sun, which has no parent and no elements', () => {
    expect(system.sun.key).toBe('sun');
    expect(system.sun.parent).toBeNull();
    expect(system.sun.elements).toBeNull();
    expect(system.bodies[0]).toBe(system.sun);
  });

  it('registers every catalogue planet and dwarf planet under its own key', () => {
    for (const spec of [...PLANETS, ...DWARF_PLANETS]) {
      const b = body(spec.key);
      expect(b.parent, spec.key).toBe(system.sun);
      expect(b.spec, spec.key).toBe(spec);
      expect(b.elements, spec.key).not.toBeNull();
      expect(b.periodDays, spec.key).toBeGreaterThan(0);
    }
  });

  it('keeps every key unique and indexed', () => {
    const keys = system.bodies.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of system.bodies) {
      expect(system.byKey.get(b.key)).toBe(b);
    }
  });

  it('links children to parents and derives depth from the tree', () => {
    expect(system.bodies.filter((b) => b.parent === null)).toEqual([system.sun]);
    expect(system.sun.depth).toBe(0);
    for (const b of system.bodies.slice(1)) {
      expect(b.parent!.children, b.key).toContain(b);
      expect(b.depth, b.key).toBe(b.parent!.depth + 1);
    }
  });

  it('prefixes keys by kind', () => {
    for (const [type, prefix] of [
      ['moon', 'moon:'],
      ['asteroid', 'sb:'],
    ] as const) {
      const bodies = system.ofType(type);
      expect(bodies.length, type).toBeGreaterThan(0);
      expect(bodies.filter((b) => !b.key.startsWith(prefix))).toEqual([]);
    }
  });

  it('does not duplicate a dwarf planet or a satellite as a minor planet', () => {
    for (const spec of DWARF_PLANETS) {
      expect(system.byKey.has(`sb:${spec.name}`), spec.name).toBe(false);
    }
    expect(system.byKey.has('moon:Charon')).toBe(true);
    expect(system.byKey.has('sb:Charon')).toBe(false);
  });

  it('builds satellite subtitles from the NAIF code', () => {
    expect(body('moon:Io').subtitle).toBe('Jupiter I — moon');
    expect(body('moon:Titan').subtitle).toBe('Saturn VI — moon');
  });

  it('flags small satellites and every minor planet as point-sprite bodies', () => {
    expect(body('moon:Moon').minor).toBe(false);
    expect(body('moon:Phobos').minor).toBe(true);
    for (const b of system.ofType('asteroid')) {
      expect(b.minor, b.key).toBe(true);
    }
  });

  it('estimates the radius of a minor planet without a measured one', () => {
    const estimated = system.ofType('asteroid').filter((b) => b.radiusEstimated);
    expect(estimated.length).toBeGreaterThan(0);
    for (const b of estimated) {
      expect(b.radiusKm, b.key).toBeGreaterThan(0);
      expect(Number.isFinite(b.radiusKm), b.key).toBe(true);
    }
  });
});

describe('Lagrange points', () => {
  it('gives each of the eight planets exactly L1 to L5', () => {
    const planets = system.ofType('planet');
    expect(planets).toHaveLength(8);
    expect(system.lagrange).toHaveLength(40);
    for (const p of planets) {
      expect(system.lagrangeOf(p.key).map((l) => l.name)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    }
    expect(system.lagrangeOf('pluto')).toEqual([]);
    expect(system.lagrangeOf('sun')).toEqual([]);
  });

  it('is reachable by key but kept out of `bodies` and out of the tree', () => {
    const l2 = body('lagrange:earth:L2');
    expect(system.bodies).not.toContain(l2);
    expect(l2.parent).toBe(body('earth'));
    expect(body('earth').children).not.toContain(l2);
    expect(l2.depth).toBe(body('earth').depth + 1);
    expect(l2.periodDays).toBe(body('earth').periodDays);
  });

  it('marks the collinear points and carries the pair', () => {
    for (const p of system.lagrange) {
      const info = p.lagrange!;
      expect(info.collinear, p.key).toBe(['L1', 'L2', 'L3'].includes(p.name));
      expect(info.primary).toBe(system.sun);
      expect(info.massRatio).toBeGreaterThan(0);
      expect(info.massRatio).toBeLessThan(0.001);
    }
    expect(body('lagrange:earth:L2').note).toMatch(/James Webb/u);
  });
});

describe('update', () => {
  describe('in true scale', () => {
    const scale = settledAt('true');

    beforeAll(() => {
      system.update(JD_TT, scale);
    });

    it('records the instant and pins the Sun to the origin', () => {
      expect(system.jdTT).toBe(JD_TT);
      expect(system.sun.helioKm).toEqual({ x: 0, y: 0, z: 0 });
      expect(system.sun.scene).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('puts Earth about one AU out and the Moon about 384,000 km from it', () => {
      expect(system.distanceToSun(body('earth')) / AU_KM).toBeCloseTo(1, 1);
      const moon = body('moon:Moon');
      expect(length(moon.localKm)).toBeGreaterThan(356_000);
      expect(length(moon.localKm)).toBeLessThan(407_000);
      expect(moon.helioKm.x).toBeCloseTo(body('earth').helioKm.x + moon.localKm.x, 3);
    });

    it('reports a plausible orbital speed', () => {
      expect(system.speedKmS(body('earth'))).toBeCloseTo(29.8, 0);
      expect(system.speedKmS(body('moon:Moon'))).toBeCloseTo(1.0, 0);
    });

    it('produces finite state for every body and every Lagrange point', () => {
      for (const b of [...system.bodies, ...system.lagrange]) {
        for (const v of [b.helioKm, b.localKm, b.scene]) {
          expect(Number.isFinite(v.x + v.y + v.z), b.key).toBe(true);
        }
        expect(b.sceneRadius, b.key).toBeGreaterThan(0);
      }
    });

    it('places Sun-Earth L1 and L2 about 1.5 million km from Earth, on the Sun line', () => {
      const earth = body('earth');
      for (const id of ['L1', 'L2']) {
        const l = body(`lagrange:earth:${id}`);
        expect(length(l.localKm) / 1e6, id).toBeCloseTo(1.5, 1);
      }
      const l1 = body('lagrange:earth:L1');
      const l2 = body('lagrange:earth:L2');
      expect(length(l1.helioKm)).toBeLessThan(length(earth.helioKm));
      expect(length(l2.helioKm)).toBeGreaterThan(length(earth.helioKm));
    });

    it('puts L4 60 degrees ahead of the planet and L5 60 degrees behind', () => {
      const jupiter = body('jupiter');
      const l4 = body('lagrange:jupiter:L4');
      const l5 = body('lagrange:jupiter:L5');
      expect(angleBetween(l4.helioKm, jupiter.helioKm)).toBeCloseTo(Math.PI / 3, 2);
      expect(angleBetween(l5.helioKm, jupiter.helioKm)).toBeCloseTo(Math.PI / 3, 2);

      // "Ahead" means along the velocity: L4 has a positive projection on it.
      const toL4 = sub(l4.helioKm, jupiter.helioKm);
      const toL5 = sub(l5.helioKm, jupiter.helioKm);
      const v = jupiter.velKm;
      expect(toL4.x * v.x + toL4.y * v.y + toL4.z * v.z).toBeGreaterThan(0);
      expect(toL5.x * v.x + toL5.y * v.y + toL5.z * v.z).toBeLessThan(0);
    });

    it('is the identity from kilometres to scene units', () => {
      const earth = body('earth');
      const ratio = length(earth.scene) / length(earth.helioKm);
      const moon = body('moon:Moon');
      expect(length(sub(moon.scene, earth.scene)) / length(moon.localKm)).toBeCloseTo(ratio, 9);
    });
  });

  describe('in explore scale', () => {
    const scale = settledAt('explore');

    beforeAll(() => {
      system.update(JD_TT, scale);
    });

    it('moves every heliocentric body radially, never sideways', () => {
      for (const b of system.sun.children) {
        expect(angleBetween(b.scene, b.helioKm), b.key).toBeLessThan(RADIAL_TOLERANCE);
      }
      for (const l of system.lagrange) {
        expect(angleBetween(l.scene, l.helioKm), l.key).toBeLessThan(RADIAL_TOLERANCE);
      }
    });

    it('moves every satellite radially about its parent', () => {
      // Depth 2 and below: everything whose parent is not the Sun.
      const satellites = system.bodies.filter((b) => b.depth > 1);
      for (const b of satellites) {
        expect(angleBetween(sub(b.scene, b.parent!.scene), b.localKm), b.key).toBeLessThan(
          RADIAL_TOLERANCE,
        );
      }
    });

    it('keeps L4 and L5 on the planet’s own drawn orbit radius', () => {
      const jupiter = body('jupiter');
      const l4 = body('lagrange:jupiter:L4');
      expect(length(l4.scene) / length(jupiter.scene)).toBeCloseTo(
        length(l4.helioKm) / length(jupiter.helioKm),
        2,
      );
    });
  });

  it('matches the golden snapshot in both scale modes', () => {
    const keys = [
      'mercury',
      'earth',
      'jupiter',
      'saturn',
      'neptune',
      'pluto',
      'ceres',
      'moon:Moon',
      'moon:Io',
      'moon:Titan',
      'moon:Titania',
      'moon:Charon',
      'lagrange:earth:L2',
      'lagrange:jupiter:L4',
    ];
    const minor = system.ofType('asteroid')[0];
    const snapshot: Record<string, unknown> = {};
    for (const mode of ['true', 'explore'] as const) {
      const scale = settledAt(mode);
      system.update(JD_TT, scale);
      for (const key of [...keys, minor.key]) {
        const b = body(key);
        snapshot[`${mode} ${key}`] = {
          helioKm: sigVec(b.helioKm),
          scene: sigVec(b.scene),
          sceneRadius: sig(b.sceneRadius),
          orientationZ: sigVec(b.orientation.z),
        };
      }
    }
    expect(snapshot).toMatchSnapshot();
  });
});

describe('orbitPolyline', () => {
  const scale = settledAt('explore');

  beforeAll(() => {
    system.update(JD_TT, scale);
  });

  it('returns nothing for the Sun', () => {
    expect(system.orbitPolyline(system.sun, scale)).toBeNull();
  });

  it('closes the loop with one extra vertex', () => {
    const line = system.orbitPolyline(body('earth'), scale, 64)!;
    expect(line).toHaveLength(65 * 3);
    expect([line[64 * 3], line[64 * 3 + 1], line[64 * 3 + 2]]).toEqual([line[0], line[1], line[2]]);
  });

  it('keeps satellite orbits relative to the parent so they survive float32', () => {
    const charon = body('moon:Charon');
    const line = system.orbitPolyline(charon, scale, 32)!;
    const parentDistance = length(charon.parent!.scene);
    for (let i = 0; i < line.length; i += 3) {
      const r = Math.hypot(line[i], line[i + 1], line[i + 2]);
      expect(r).toBeLessThan(parentDistance / 1000);
      expect(r).toBeGreaterThan(0);
    }
  });
});

describe('queries', () => {
  it('lists moons of a body largest first', () => {
    const moons = system.moonsOf('jupiter');
    expect(moons[0].name).toBe('Ganymede');
    for (let i = 1; i < moons.length; i++) {
      expect(moons[i - 1].radiusKm).toBeGreaterThanOrEqual(moons[i].radiusKm);
    }
    expect(system.moonsOf('nowhere')).toEqual([]);
  });

  it('filters by type in catalogue order', () => {
    expect(system.ofType('star')).toEqual([system.sun]);
    expect(system.ofType('planet').map((b) => b.key)).toEqual(PLANETS.map((p) => p.key));
  });

  it('derives escape velocity and the Hill radius', () => {
    expect(escapeVelocity(GM.earth, 6371)).toBeCloseTo(11.19, 1);
    system.update(JD_TT, settledAt('true'));
    expect(hillRadius(body('earth'))! / 1e6).toBeCloseTo(1.5, 1);
    expect(hillRadius(system.sun)).toBeNull();
    expect(hillRadius(body('moon:Moon'))).toBeNull();
  });
});
