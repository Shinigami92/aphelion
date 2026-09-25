/**
 * The simulated body tree: how it is built.
 *
 * `pnpm validate` owns the accuracy checks against real ephemerides; this file
 * pins down the structure and the invariants the renderer leans on, so the
 * module can be split without anyone having to re-derive them:
 *
 *   - the tree is built once, parents before children, with stable keys;
 *   - Lagrange points are reachable by key but stay out of `bodies`;
 *
 * The per-frame solve is in system-update.spec.ts.
 */

import { describe, expect, it } from 'vitest';
import { PLANETS } from '../src/data/bodies.ts';
import { DWARF_PLANETS } from '../src/data/bodies/dwarf-planets.ts';
import { body, system } from './system-fixture.ts';

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
