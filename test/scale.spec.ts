/**
 * Scale models.
 *
 * The property the whole renderer rests on is monotonicity: if A is further out
 * than B at true scale, it must still be after the explore remap, or orbits
 * cross and moons swap places. The other load-bearing fact is that true scale is
 * exactly the identity — no sneaky enlargement at blend 0.
 */

import { describe, expect, it } from 'vitest';
import { AU_KM, SCENE_UNIT_KM } from '../src/core/constants.ts';
import { DEFAULT_PARAMS, ScaleModel } from '../src/core/scale.ts';

const settledAt = (mode: 'true' | 'explore'): ScaleModel => {
  const s = new ScaleModel();
  s.setMode(mode);
  s.snap();
  return s;
};

const SATURN_RADIUS_KM = 60_268;
const TITAN_DISTANCE_KM = 1_221_870;

// Saturn's ring span, in Saturn radii — the region the knee is there to protect.
const RING_INNER_RADII = 1.24;
const RING_OUTER_RADII = 2.33;

/** Where a Saturn satellite would land if the knee applied no compression at all. */
const proportional = (inParentRadii: number): number =>
  (SATURN_RADIUS_KM * DEFAULT_PARAMS.bodyScale * inParentRadii) / SCENE_UNIT_KM;

describe('true scale is the identity', () => {
  const s = settledAt('true');

  it('leaves every body radius untouched', () => {
    for (const km of [1737, 6371, 69_911]) {
      expect(s.bodyRadius(km) * SCENE_UNIT_KM).toBeCloseTo(km, 6);
    }
    expect(s.radiusMultiplier).toBe(1);
    expect(s.reliefExaggeration(4)).toBe(1);
  });

  it('leaves every heliocentric and satellite distance untouched', () => {
    for (const km of [AU_KM * 0.39, AU_KM, AU_KM * 30]) {
      expect(s.heliocentricDistance(km) * SCENE_UNIT_KM).toBeCloseTo(km, 3);
      expect(s.heliocentricFactor(km)).toBeCloseTo(1, 9);
    }
    expect(s.satelliteDistance(TITAN_DISTANCE_KM, SATURN_RADIUS_KM) * SCENE_UNIT_KM).toBeCloseTo(
      TITAN_DISTANCE_KM,
      3,
    );
    expect(s.satelliteFactor(TITAN_DISTANCE_KM, SATURN_RADIUS_KM)).toBeCloseTo(1, 9);
  });
});

describe('explore scale stays monotone', () => {
  const s = settledAt('explore');

  it('preserves heliocentric ordering across all eight planets', () => {
    const semiMajorAxesKm = [5.79e7, 1.08e8, 1.5e8, 2.28e8, 7.78e8, 1.43e9, 2.87e9, 4.5e9];
    let previous = -Infinity;
    for (const km of semiMajorAxesKm) {
      const mapped = s.heliocentricDistance(km);
      expect(mapped).toBeGreaterThan(previous);
      previous = mapped;
    }
  });

  it('preserves satellite ordering across and through the knee', () => {
    const inParentRadii = [1.2, 2.0, 3.0, 3.001, 5, 20, 60, 215];
    let previous = -Infinity;
    for (const radii of inParentRadii) {
      const mapped = s.satelliteDistance(radii * SATURN_RADIUS_KM, SATURN_RADIUS_KM);
      expect(mapped).toBeGreaterThan(previous);
      previous = mapped;
    }
  });

  it('pins Earth’s orbit to the same size as true scale, so the transition is not a zoom', () => {
    expect(s.heliocentricDistance(AU_KM) * SCENE_UNIT_KM).toBeCloseTo(AU_KM, 3);
  });
});

describe('the satellite knee', () => {
  const s = settledAt('explore');
  const knee = DEFAULT_PARAMS.satelliteKnee;
  const mappedRadii = (inParentRadii: number): number =>
    s.satelliteDistance(inParentRadii * SATURN_RADIUS_KM, SATURN_RADIUS_KM);

  it('is proportional below and up to the knee', () => {
    expect(mappedRadii(1)).toBeCloseTo(proportional(1), 6);
    expect(mappedRadii(knee)).toBeCloseTo(proportional(knee), 6);
  });

  it('is continuous where the power law takes over — only the slope steps', () => {
    const justBelow = mappedRadii(knee - 1e-9);
    const justAbove = mappedRadii(knee + 1e-9);
    expect(Math.abs(justAbove - justBelow) / justBelow).toBeLessThan(1e-6);
  });

  it('holds Saturn’s rings at true proportion — the reason it exists', () => {
    expect(mappedRadii(RING_OUTER_RADII) / mappedRadii(RING_INNER_RADII)).toBeCloseTo(
      RING_OUTER_RADII / RING_INNER_RADII,
      6,
    );
  });
});

describe('blend easing', () => {
  it('reports a transition only while the blend is still moving, then settles on target', () => {
    const s = new ScaleModel();
    s.setMode('true');
    expect(s.isTransitioning).toBe(true);
    for (let i = 0; i < 200; i++) {
      s.update(1 / 60);
    }
    expect(s.isTransitioning).toBe(false);
    expect(s.blendAmount).toBeCloseTo(0, 6);
  });

  it('eases monotonically from explore toward true', () => {
    const s = new ScaleModel();
    s.snap();
    s.setMode('true');
    let previous = s.blendAmount;
    for (let i = 0; i < 60; i++) {
      s.update(1 / 60);
      expect(s.blendAmount).toBeLessThanOrEqual(previous + 1e-9);
      previous = s.blendAmount;
    }
  });
});
