/**
 * The VR Bodies tab's list model (src/ui/xr/body-list.ts): the page's body
 * tree flattened into rows, with open rows expanded and long child lists
 * capped so a headset never builds hundreds of rows at once.
 */

import type { ListRow } from '../src/ui/xr/body-list.ts';
import { describe, expect, it } from 'vitest';
import { bodyRows, CHILD_LIMIT } from '../src/ui/xr/body-list.ts';
import { system } from './system-fixture.ts';

const headings = (rows: ListRow[]): string[] =>
  rows.flatMap((row) => (row.kind === 'heading' ? [row.label] : []));

const bodyKeys = (rows: ListRow[], depth: 0 | 1): string[] =>
  rows.flatMap((row) => (row.kind === 'body' && row.depth === depth ? [row.body.key] : []));

/** The row showing the body `key`. */
function rowOf(rows: ListRow[], key: string): ListRow {
  const found = rows.find((row) => row.kind === 'body' && row.body.key === key);
  if (!found) {
    throw new Error(`no row for '${key}'`);
  }
  return found;
}

const radiusOf = (key: string): number => system.byKey.get(key)?.radiusKm ?? 0;

/** The first minor-planet family row. */
function firstFamily(rows: ListRow[]): ListRow & { kind: 'family' } {
  for (const row of rows) {
    if (row.kind === 'family') {
      return row;
    }
  }
  throw new Error('no family row');
}

describe('bodyRows', () => {
  it('lists the Sun, then planets, dwarf planets and minor-planet families, all closed', () => {
    const rows = bodyRows(system, new Set(), true);
    expect(rows[0]).toMatchObject({ kind: 'body', depth: 0, body: system.sun });
    expect(headings(rows).slice(0, 2)).toEqual(['Planets', 'Dwarf planets']);
    expect(headings(rows)[2]).toMatch(/^Minor planets \(\d+\)$/u);
    expect(bodyKeys(rows, 0)).toEqual(expect.arrayContaining(['earth', 'saturn', 'pluto']));
    expect(bodyKeys(rows, 1)).toEqual([]);
    expect(rows.some((row) => row.kind === 'family')).toBe(true);
  });

  it('opens a planet to its Lagrange points first, then its moons by size', () => {
    const rows = bodyRows(system, new Set(['earth']), true);
    const children = bodyKeys(rows, 1);
    expect(children.slice(0, 5)).toEqual(system.lagrangeOf('earth').map((point) => point.key));
    expect(children[5]).toBe('moon:Moon');
  });

  it('leaves the Lagrange points out while their layer is off', () => {
    const rows = bodyRows(system, new Set(['earth']), false);
    expect(bodyKeys(rows, 1)).toEqual(['moon:Moon']);
    // Moonless, and with no points to show, Mercury has nothing to open.
    expect(rowOf(rows, 'mercury')).toMatchObject({ meta: '', expandKey: null });
  });

  it('caps a long list of moons and counts the rest', () => {
    const moons = system.moonsOf('saturn').length;
    expect(moons).toBeGreaterThan(CHILD_LIMIT);
    const rows = bodyRows(system, new Set(['saturn']), false);
    expect(bodyKeys(rows, 1)).toHaveLength(CHILD_LIMIT);
    expect(rows).toContainEqual({ kind: 'more', label: `and ${moons - CHILD_LIMIT} smaller` });
    const sizes = bodyKeys(rows, 1).map(radiusOf);
    expect(sizes).toEqual(sizes.toSorted((a, b) => b - a));
  });

  it('opens a minor-planet family to its members, largest first', () => {
    const family = firstFamily(bodyRows(system, new Set(), false));
    const rows = bodyRows(system, new Set([family.expandKey]), false);
    const members = bodyKeys(rows, 1);
    expect(members.length).toBe(Math.min(Number(family.meta), CHILD_LIMIT));
    for (const key of members) {
      expect(system.byKey.get(key)?.subtitle).toBe(family.label);
    }
  });
});
