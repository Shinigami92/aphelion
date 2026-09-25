/** Jupiter and its faint rings. */

import type { BodySpec } from '../body-spec.ts';

export const JUPITER: BodySpec = {
  key: 'jupiter',
  name: 'Jupiter',
  type: 'planet',
  parent: 'sun',
  radiusKm: 71_492,
  flattening: 0.06487,
  spin: {
    poleRa: 268.056595,
    poleRaDot: -0.006499,
    poleDec: 64.495303,
    poleDecDot: 0.002413,
    w0: 284.95,
    wDot: 870.536,
  },
  color: 0xc9a882,
  textures: { map: 'jupiter.jpg' },
  atmosphere: {
    thicknessKm: 1200,
    rayleigh: [0.7, 0.6, 0.45],
    mie: 0.4,
    // Rayleigh depth of an H2/He column to 1 bar, at 440 nm. Column density
    // goes as P/(m*g): at 2.22 u against air's 28.97 and this body's own
    // `gravity` of 24.79, that is 5.2x Earth's column, and H2/He scatters
    // 0.18x as strongly per molecule (refractivity 1.25e-4 against 2.93e-4,
    // squared). 5.2 * 0.18 * 0.237 = 0.22.
    density: 0.22,
    groundTint: [0.95, 0.85, 0.7],
  },
  rings: [
    {
      name: 'Halo',
      innerKm: 92_000,
      outerKm: 122_500,
      opacity: 0.035,
      exploreBoost: 60,
      exploreBrightness: 3,
      note: 'dust lofted by electromagnetic forces',
      bands: [{ name: 'Halo', innerKm: 92_000, outerKm: 122_500, tau: 1e-6, color: 0x7a6250 }],
    },
    {
      name: 'Main ring',
      innerKm: 122_500,
      outerKm: 129_000,
      opacity: 0.16,
      exploreBoost: 25,
      exploreBrightness: 3,
      note: 'debris from Adrastea and Metis',
      // Jupiter's rings are dust, not ice: reddish, and optically thin enough
      // to see stars through. The outer edge is Adrastea's orbit, because
      // that is where the dust comes from.
      bands: [
        {
          name: 'Main ring (inner)',
          innerKm: 122_500,
          outerKm: 128_000,
          tau: 3e-6,
          color: 0x9a7358,
        },
        {
          name: 'Main ring (bright core)',
          innerKm: 128_000,
          outerKm: 129_000,
          tau: 6e-6,
          color: 0xa87d5e,
          cause: 'bounded by the orbits of Metis and Adrastea, its sources',
        },
      ],
    },
    {
      name: 'Gossamer rings',
      innerKm: 129_000,
      outerKm: 226_000,
      opacity: 0.025,
      exploreBoost: 90,
      exploreBrightness: 4,
      note: 'fed by Amalthea and Thebe',
      bands: [
        {
          name: 'Amalthea gossamer ring',
          innerKm: 129_000,
          outerKm: 182_000,
          tau: 1e-7,
          color: 0x8a6a56,
          cause: 'dust knocked off Amalthea, bounded by its orbit',
        },
        {
          name: 'Thebe gossamer ring',
          innerKm: 182_000,
          outerKm: 226_000,
          tau: 3e-8,
          color: 0x8a6a56,
          cause: 'dust knocked off Thebe, bounded by its orbit',
        },
      ],
    },
  ],
  facts: {
    mass: 1.8982e27,
    gravity: 24.79,
    escapeVelocity: 59.5,
    rotationHours: 9.925,
    axialTilt: 3.13,
    temperatureC: -110,
    albedo: 0.503,
    composition: '90% H2 / 10% He, likely a diffuse rocky-ice core',
    discovered: 'prehistoric',
    blurb:
      'More massive than every other planet combined. The Great Red Spot is a storm wider than Earth that has been under observation for over 190 years. Rotates in under 10 hours, visibly flattening the disc.',
  },
};
