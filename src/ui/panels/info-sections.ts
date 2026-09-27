/**
 * The parts of the info panel that are chosen per body rather than computed:
 * its caveat badge, which fact sections it gets, and its composition rows.
 *
 * Pure, and shared by the page's info panel and the headset's Info tab.
 */

import type { SimBody } from '../../core/system.ts';
import type { FactRow } from './info-facts.ts';
import { lagrangeOrbitRows, lagrangePhysicalRows, orbitRows, physicalRows } from './info-facts.ts';

/**
 * The caveats worth stating up front, shown as a badge under the name.
 *
 * "surface synthesised" is a statement about imagery we do not have; a
 * Lagrange point has no surface to have imagery of.
 */
export function badgeFlags(body: SimBody): string[] {
  const flags: string[] = [];
  if (body.radiusEstimated) {
    flags.push('size estimated');
  }
  if ((body.textureFile === null || body.textureFile === '') && body.type !== 'lagrange') {
    flags.push('surface synthesised');
  }
  if (body.type === 'lagrange') {
    flags.push('massless point — nothing is drawn here');
  }
  if (body.sat?.frame === 'laplace') {
    flags.push('Laplace-plane elements');
  }
  return flags;
}

/**
 * The "Physical" and "Orbit" sections. A Lagrange point shares no field with a
 * body, so both of its sections are filled from the pair instead.
 */
export function factSections(body: SimBody): { physical: FactRow[]; orbit: FactRow[] } {
  if (body.type === 'lagrange') {
    return { physical: lagrangePhysicalRows(body), orbit: lagrangeOrbitRows(body) };
  }
  return { physical: physicalRows(body), orbit: orbitRows(body) };
}

/** What a body is made of, and the family a minor planet belongs to. */
export function compositionRows(body: SimBody): FactRow[] {
  const rows: FactRow[] = [];
  const composition = body.spec?.facts.composition;
  if (composition !== undefined && composition !== '') {
    rows.push(['Makeup', composition, true]);
  }
  if (body.small) {
    rows.push(['Family', body.subtitle, true]);
  }
  return rows;
}
