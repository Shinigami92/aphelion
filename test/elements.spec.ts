/**
 * Orbital elements read from the JPL satellite table.
 *
 * JPL publishes the apsidal and nodal precession as unsigned periods, so the
 * signs are supplied here, and a wrong one is invisible at the epoch and only
 * shows years later as a moon on the wrong side of its planet. `pnpm validate`
 * checks the result against Horizons; these pin down the rule itself.
 */

import type { SatelliteData } from '../src/data/generated/satellites.ts';
import { describe, expect, it } from 'vitest';
import { TWO_PI } from '../src/core/constants.ts';
import { elementsFromSatellite } from '../src/core/system/elements.ts';
import { SATELLITES } from '../src/data/generated/satellites.ts';

const JULIAN_YEAR_DAYS = 365.25;

const satellite = (name: string): SatelliteData => {
  const sat = SATELLITES.find((s) => s.name === name);
  if (!sat) {
    throw new Error(`${name} is missing from the satellite table`);
  }
  return sat;
};

describe('precession signs', () => {
  it('advances the apsis and regresses the node of a prograde moon', () => {
    const himalia = satellite('Himalia');
    const el = elementsFromSatellite(himalia);
    expect(el.argPeriDot).toBeCloseTo(TWO_PI / (himalia.apsisPeriod! * JULIAN_YEAR_DAYS), 12);
    expect(el.nodeDot).toBeCloseTo(-TWO_PI / (himalia.nodePeriod! * JULIAN_YEAR_DAYS), 12);
  });

  it('advances both the apsis and the node of a retrograde moon', () => {
    const pasiphae = satellite('Pasiphae');
    const el = elementsFromSatellite(pasiphae);
    expect(el.argPeriDot).toBeCloseTo(TWO_PI / (pasiphae.apsisPeriod! * JULIAN_YEAR_DAYS), 12);
    expect(el.nodeDot).toBeCloseTo(TWO_PI / (pasiphae.nodePeriod! * JULIAN_YEAR_DAYS), 12);
  });

  it('holds a moon with no published precession fixed', () => {
    const el = elementsFromSatellite({
      ...satellite('Pasiphae'),
      apsisPeriod: null,
      nodePeriod: 0,
    });
    expect(el.argPeriDot).toBe(0);
    expect(el.nodeDot).toBe(0);
  });

  it('never regresses an apsis, and moves every node against cos i', () => {
    for (const sat of SATELLITES) {
      const el = elementsFromSatellite(sat);
      expect(el.argPeriDot, sat.name).toBeGreaterThanOrEqual(0);
      expect(el.nodeDot! * Math.cos(el.i), sat.name).toBeLessThanOrEqual(0);
    }
  });
});
