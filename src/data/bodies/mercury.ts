/** Mercury. */

import type { BodySpec } from '../body-spec.ts';

export const MERCURY: BodySpec = {
  key: 'mercury',
  name: 'Mercury',
  type: 'planet',
  parent: 'sun',
  radiusKm: 2439.7,
  flattening: 0,
  spin: {
    poleRa: 281.0103,
    poleRaDot: -0.0328,
    poleDec: 61.4155,
    poleDecDot: -0.0049,
    w0: 329.5988,
    wDot: 6.1385108,
  },
  color: 0x9c8e82,
  textures: { map: 'mercury.jpg' },
  facts: {
    mass: 3.3011e23,
    gravity: 3.7,
    escapeVelocity: 4.25,
    rotationHours: 1407.6,
    axialTilt: 0.034,
    temperatureC: 167,
    albedo: 0.088,
    composition: 'Iron core filling 85% of the radius, thin silicate mantle',
    discovered: 'prehistoric',
    blurb:
      'Locked in a 3:2 spin-orbit resonance, so a solar day lasts two Mercurian years. Surface swings from -180 to 430 C, yet radar finds water ice in permanently shadowed polar craters.',
  },
};
