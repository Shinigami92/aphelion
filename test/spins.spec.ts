/**
 * The info panel's rotation facts against the spin the renderer actually uses.
 *
 * Each BodySpec states its rotation twice: once as a `spin` model that turns the
 * mesh, once as `facts` the panel prints. Nothing tied them together, and the
 * dwarf planets drifted apart: Haumea turned once in 8.2 hours, not 3.9, and
 * Makemake in 276, not 22.8; Eris's facts said 15.8 hours for a spin of 15.8
 * days; Makemake and Eris spun about the ICRF pole while their facts quoted
 * tilts of 0° and 78°; and Haumea's 126° was its moon's inclination.
 */

import type { Vec3 } from '../src/astro/kepler.ts';
import type { BodySpec } from '../src/data/body-spec.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { spinBasis } from '../src/astro/frames.ts';
import { ALL_BODY_SPECS } from '../src/data/bodies.ts';
import { angleBetween, body, settledAt, system } from './system-fixture.ts';

const J2000 = 2451545;

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * The spin's angular momentum at J2000. A negative wDot turns the body backwards
 * about the pole it names, as the IAU does for the planets; the dwarf planets
 * name the pole they turn about.
 */
function spinAxis(spec: BodySpec): Vec3 {
  const pole = spinBasis(spec.spin, 0, 0).z;
  const sense = Math.sign(spec.spin.wDot);
  return { x: pole.x * sense, y: pole.y * sense, z: pole.z * sense };
}

/** The orbit's angular momentum at J2000; the Sun's tilt is quoted to the ecliptic. */
function orbitPole(spec: BodySpec): Vec3 {
  if (spec.key === 'sun') {
    return { x: 0, y: 0, z: 1 };
  }
  const b = body(spec.key);
  return cross(b.helioKm, b.velKm);
}

describe('rotation facts', () => {
  beforeAll(() => {
    system.update(J2000, settledAt('true'));
  });

  it.each(ALL_BODY_SPECS)('$key turns at its stated period', (spec) => {
    const hours = (360 * 24) / Math.abs(spec.spin.wDot);
    expect(hours / Math.abs(spec.facts.rotationHours)).toBeCloseTo(1, 3);
  });

  it.each(ALL_BODY_SPECS)('$key is tilted as stated', (spec) => {
    const tilt = (angleBetween(spinAxis(spec), orbitPole(spec)) * 180) / Math.PI;
    // Fact sheets quote obliquity against the mean orbit and the pole of date,
    // this against the osculating orbit and the IAU pole at J2000; Neptune, whose
    // pole nods by half a degree, is the widest apart.
    expect(Math.abs(tilt - spec.facts.axialTilt)).toBeLessThan(1);
  });

  it.each(ALL_BODY_SPECS)(
    '$key calls its rotation retrograde only when tilted past 90°',
    (spec) => {
      expect(spec.facts.rotationHours < 0).toBe(spec.facts.axialTilt > 90);
    },
  );
});
