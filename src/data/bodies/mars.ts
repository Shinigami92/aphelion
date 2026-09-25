/** Mars. */

import type { BodySpec } from '../body-spec.ts';

export const MARS: BodySpec = {
  key: 'mars',
  name: 'Mars',
  type: 'planet',
  parent: 'sun',
  radiusKm: 3396.2,
  flattening: 0.00589,
  spin: {
    poleRa: 317.681,
    poleRaDot: -0.106,
    poleDec: 52.887,
    poleDecDot: -0.061,
    w0: 176.63,
    wDot: 350.89198226,
  },
  color: 0xc1502e,
  textures: { map: 'mars.jpg' },
  atmosphere: {
    thicknessKm: 60,
    rayleigh: [0.55, 0.4, 0.32],
    mie: 0.55,
    // Suspended dust, not gas: 6 mbar of CO2 has a Rayleigh depth of only
    // ~0.006, while Viking and the MERs measured dust columns of 0.3-0.6 in
    // ordinary seasons and under 0.1 at the clearest. This is a clear-season
    // figure, which is why the tint above is dust-coloured rather than blue.
    density: 0.15,
    groundTint: [0.75, 0.55, 0.45],
  },
  facts: {
    mass: 6.4171e23,
    gravity: 3.721,
    escapeVelocity: 5.027,
    rotationHours: 24.622962,
    axialTilt: 25.19,
    temperatureC: -65,
    albedo: 0.25,
    composition: '95% CO2 at 6 mbar, iron-oxide dust over basalt',
    discovered: 'prehistoric',
    blurb:
      'Home to Olympus Mons, 22 km tall, and Valles Marineris, a canyon system stretching a fifth of the way around the planet. Dust storms occasionally shroud the entire globe for weeks.',
  },
};
