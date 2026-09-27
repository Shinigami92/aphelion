/**
 * The Bodies tab's list, as data: the page's body tree — the Sun, planets and
 * dwarf planets expandable to their moons, minor planets grouped by family —
 * flattened into rows.
 *
 * Pure, so it is tested without a headset. The one departure from the page is
 * a cap on how many children an open row lists. Saturn has 291 moons; building
 * that many rows in a headset stalls a frame, which is felt rather than seen,
 * and a list that long cannot be scrolled with a ray anyway. The largest are
 * listed and the rest counted.
 */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import { localDistance, moonCount, moonMeta, sortMoons } from '../panels/browser-order.ts';
import { fmt, formatDistance } from '../panels/format.ts';

/** How many children an open row lists at most. */
export const CHILD_LIMIT = 40;

export type ListRow =
  | { kind: 'heading'; label: string }
  | { kind: 'body'; body: SimBody; depth: 0 | 1; meta: string; expandKey: string | null }
  | { kind: 'family'; label: string; meta: string; expandKey: string }
  | { kind: 'more'; label: string };

function bodyRow(body: SimBody, depth: 0 | 1, meta: string, expandable = false): ListRow {
  return { kind: 'body', body, depth, meta, expandKey: expandable ? body.key : null };
}

/** The first `CHILD_LIMIT` of `children`, and a count of the rest. */
function capped(children: ListRow[]): ListRow[] {
  if (children.length <= CHILD_LIMIT) {
    return children;
  }
  const rest = children.length - CHILD_LIMIT;
  return [...children.slice(0, CHILD_LIMIT), { kind: 'more', label: `and ${rest} smaller` }];
}

/** What a planet or dwarf row promises when opened: moons, or else Lagrange points. */
function childMeta(system: SolarSystem, body: SimBody, lagrangeShown: boolean): string {
  if (system.moonsOf(body.key).length > 0) {
    return moonCount(body);
  }
  const points = lagrangeShown ? system.lagrangeOf(body.key).length : 0;
  return points > 0 ? `${points} Lagrange points` : '';
}

/** A planet's or dwarf's open children: its Lagrange points first, then moons by size. */
function openChildren(system: SolarSystem, body: SimBody, lagrangeShown: boolean): ListRow[] {
  const points = lagrangeShown ? system.lagrangeOf(body.key) : [];
  const moons = sortMoons(system.moonsOf(body.key), 'size');
  return [
    ...points.map((point) => bodyRow(point, 1, formatDistance(localDistance(point)))),
    ...capped(moons.map((moon) => bodyRow(moon, 1, moonMeta(moon, 'size')))),
  ];
}

function hostGroup(
  system: SolarSystem,
  type: 'planet' | 'dwarf',
  expanded: ReadonlySet<string>,
  lagrangeShown: boolean,
): ListRow[] {
  const rows: ListRow[] = [
    { kind: 'heading', label: type === 'planet' ? 'Planets' : 'Dwarf planets' },
  ];
  for (const body of system.sun.children.filter((b) => b.type === type)) {
    const meta = childMeta(system, body, lagrangeShown);
    rows.push(bodyRow(body, 0, meta, meta !== ''));
    if (expanded.has(body.key)) {
      rows.push(...openChildren(system, body, lagrangeShown));
    }
  }
  return rows;
}

function minorGroup(system: SolarSystem, expanded: ReadonlySet<string>): ListRow[] {
  const minor = system.sun.children.filter((b) => b.type === 'asteroid');
  const families = new Map<string, SimBody[]>();
  for (const body of minor) {
    const family = families.get(body.subtitle);
    if (family) {
      family.push(body);
    } else {
      families.set(body.subtitle, [body]);
    }
  }
  const rows: ListRow[] = [{ kind: 'heading', label: `Minor planets (${minor.length})` }];
  for (const [family, bodies] of families) {
    const expandKey = `family:${family}`;
    rows.push({ kind: 'family', label: family, meta: String(bodies.length), expandKey });
    if (expanded.has(expandKey)) {
      const bySize = bodies.toSorted((a, b) => b.radiusKm - a.radiusKm);
      rows.push(
        ...capped(bySize.map((body) => bodyRow(body, 1, `${fmt(body.radiusKm * 2, 0)} km`))),
      );
    }
  }
  return rows;
}

/** Every row of the list, with the rows in `expanded` opened. */
export function bodyRows(
  system: SolarSystem,
  expanded: ReadonlySet<string>,
  lagrangeShown: boolean,
): ListRow[] {
  return [
    bodyRow(system.sun, 0, ''),
    ...hostGroup(system, 'planet', expanded, lagrangeShown),
    ...hostGroup(system, 'dwarf', expanded, lagrangeShown),
    ...minorGroup(system, expanded),
  ];
}
