/**
 * The per-body choices both info panels share (src/ui/panels/info-sections.ts):
 * the caveat badge, which fact sections a body gets, and its composition rows.
 * Moved out of the page's InfoPanel so the headset's Info tab says the same.
 */

import type { SimBody } from '../src/core/system.ts';
import { describe, expect, it } from 'vitest';
import { lagrangePhysicalRows, physicalRows } from '../src/ui/panels/info-facts.ts';
import { badgeFlags, compositionRows, factSections } from '../src/ui/panels/info-sections.ts';
import { body, system } from './system-fixture.ts';

/** The first body matching `test`. */
function first(test: (b: SimBody) => boolean): SimBody {
  const found = system.bodies.find(test);
  if (!found) {
    throw new Error('no such body');
  }
  return found;
}

const isSmall = (b: SimBody): boolean => b.small !== null;

const isSynthesisedSmall = (b: SimBody): boolean =>
  isSmall(b) && (b.textureFile === null || b.textureFile === '');

describe('badgeFlags', () => {
  it('says nothing about a planet with imagery and a measured size', () => {
    expect(badgeFlags(body('earth'))).toEqual([]);
  });

  it('marks a Lagrange point as a massless point, never as a synthesised surface', () => {
    const point = system.lagrangeOf('earth')[0];
    expect(badgeFlags(point)).toEqual(['massless point — nothing is drawn here']);
  });

  it('marks a small body without imagery as synthesised', () => {
    const rock = first(isSynthesisedSmall);
    expect(badgeFlags(rock)).toContain('surface synthesised');
  });
});

describe('factSections', () => {
  it('fills a body from its own facts and a Lagrange point from its pair', () => {
    expect(factSections(body('mars')).physical).toEqual(physicalRows(body('mars')));
    const point = system.lagrangeOf('earth')[1];
    expect(factSections(point).physical).toEqual(lagrangePhysicalRows(point));
  });
});

describe('compositionRows', () => {
  it('gives a small body its family', () => {
    const rock = first(isSmall);
    expect(compositionRows(rock)).toContainEqual(['Family', rock.subtitle, true]);
  });
});
