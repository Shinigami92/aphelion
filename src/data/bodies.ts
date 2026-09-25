/**
 * The Sun, the planets and the dwarf planets: physical properties, rotation
 * models, ring systems, atmospheres and the facts shown in the info panel.
 *
 * Radii are mean radii in km unless a flattening is given, in which case the
 * equatorial radius is used for rendering and the oblateness is applied as a
 * vertical squash. Rotation models are the IAU values (see astro/frames.ts).
 *
 * Each planet has its own file under bodies/, next to the dwarf planets and the
 * satellite and small-body tables; the types are in body-spec.ts.
 */

import type { BodySpec } from './body-spec.ts';
import { DWARF_PLANETS } from './bodies/dwarf-planets.ts';
import { EARTH } from './bodies/earth.ts';
import { JUPITER } from './bodies/jupiter.ts';
import { MARS } from './bodies/mars.ts';
import { MERCURY } from './bodies/mercury.ts';
import { NEPTUNE } from './bodies/neptune.ts';
import { SATURN } from './bodies/saturn.ts';
import { URANUS } from './bodies/uranus.ts';
import { VENUS } from './bodies/venus.ts';

export const SUN: BodySpec = {
  key: 'sun',
  name: 'Sun',
  type: 'star',
  parent: null,
  radiusKm: 695_700,
  flattening: 0.000009,
  spin: { poleRa: 286.13, poleDec: 63.87, w0: 84.176, wDot: 14.1844 },
  color: 0xfff4e0,
  textures: { map: 'sun.jpg' },
  emissive: true,
  facts: {
    mass: 1.9885e30,
    gravity: 274,
    escapeVelocity: 617.7,
    rotationHours: 609.12,
    axialTilt: 7.25,
    temperatureC: 5505,
    albedo: 0,
    composition: 'Hydrogen 73%, helium 25%, oxygen/carbon/iron 2%',
    discovered: 'prehistoric',
    blurb:
      'A G2V main-sequence star holding 99.86% of the mass of the solar system. Fuses ~600 million tonnes of hydrogen every second; the light reaching Earth left the surface 8 minutes 20 seconds ago.',
  },
};

/** The eight planets, in order from the Sun. */
export const PLANETS: BodySpec[] = [MERCURY, VENUS, EARTH, MARS, JUPITER, SATURN, URANUS, NEPTUNE];

export const ALL_BODY_SPECS: BodySpec[] = [SUN, ...PLANETS, ...DWARF_PLANETS];

export const BODY_SPECS_BY_KEY: Map<string, BodySpec> = new Map(
  ALL_BODY_SPECS.map((b) => [b.key, b]),
);
