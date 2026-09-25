/**
 * The generated background populations.
 *
 * The belt is statistical, so the values themselves are not the contract; what
 * is: it looks the same on every run, the groups tile the shared arrays with no
 * gap or overlap, and the structure the module promises (Kirkwood gaps, Trojan
 * camps at Jupiter's distance) is really in the numbers.
 */

import type { SwarmData } from '../src/data/belts.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSwarms, swarmSummary } from '../src/data/belts.ts';

let swarms: SwarmData;

beforeAll(() => {
  swarms = buildSwarms();
});

const group = (prefix: string): SwarmData['groups'][number] => {
  const found = swarms.groups.find((g) => g.name.startsWith(prefix));
  if (!found) {
    throw new Error(`no group '${prefix}'`);
  }
  return found;
};

/** Semi-major axes of a group, AU. */
const axesOf = (prefix: string): Float32Array => {
  const g = group(prefix);
  return swarms.a.subarray(g.offset, g.offset + g.count);
};

/** How many of `axes` fall in [lo, hi). */
const countWithin = (axes: Float32Array, lo: number, hi: number): number =>
  axes.filter((a) => a >= lo && a < hi).length;

describe('layout', () => {
  it('tiles the arrays with its groups, in order and without gaps', () => {
    let offset = 0;
    for (const g of swarms.groups) {
      expect(g.offset, g.name).toBe(offset);
      expect(g.count, g.name).toBeGreaterThan(0);
      offset += g.count;
    }
    expect(offset).toBe(swarms.total);
    for (const array of [
      swarms.a,
      swarms.e,
      swarms.inc,
      swarms.node,
      swarms.argPeri,
      swarms.m0,
      swarms.n,
      swarms.size,
    ]) {
      expect(array).toHaveLength(swarms.total);
    }
    expect(swarms.color).toHaveLength(swarms.total * 3);
  });

  it('fills every slot with a bound, finite orbit', () => {
    expect(Math.min(...swarms.a)).toBeGreaterThan(0);
    expect(Math.min(...swarms.e)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...swarms.e)).toBeLessThan(1);
    expect(Math.min(...swarms.n)).toBeGreaterThan(0);
    expect(Math.min(...swarms.size)).toBeGreaterThan(0);
    for (const array of [swarms.inc, swarms.node, swarms.argPeri, swarms.m0]) {
      expect(array.every(Number.isFinite)).toBe(true);
    }
  });

  it('builds once and hands back the same data', () => {
    expect(buildSwarms()).toBe(swarms);
  });

  it('summarises every group for the UI', () => {
    expect(swarmSummary()).toEqual(swarms.groups.map((g) => ({ name: g.name, count: g.count })));
  });
});

describe('structure', () => {
  it('puts the Trojan camps at Jupiter’s distance', () => {
    for (const camp of ['Jupiter Trojans (L4', 'Jupiter Trojans (L5']) {
      for (const a of axesOf(camp)) {
        expect(a).toBeGreaterThan(4.9);
        expect(a).toBeLessThan(5.5);
      }
    }
  });

  it('carves the 3:1 Kirkwood gap out of the main belt', () => {
    const axes = axesOf('Main belt');
    // 3:1 with Jupiter is at 2.50 AU. Compare the gap with its shoulders.
    const gap = countWithin(axes, 2.49, 2.51);
    const shoulders = (countWithin(axes, 2.44, 2.46) + countWithin(axes, 2.54, 2.56)) / 2;
    expect(gap).toBeLessThan(shoulders / 3);
  });

  it('keeps the Kuiper belt beyond Neptune', () => {
    for (const a of axesOf('Classical Kuiper belt (cold)')) {
      expect(a).toBeGreaterThan(30);
    }
  });

  it('matches the golden summary', () => {
    const summary = swarms.groups.map((g) => ({
      name: g.name,
      count: g.count,
      firstA: Number(swarms.a[g.offset].toPrecision(6)),
    }));
    expect(summary).toMatchSnapshot();
  });
});
