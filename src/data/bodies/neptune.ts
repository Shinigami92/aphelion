/** Neptune and its ring arcs. */

import type { BodySpec } from '../body-spec.ts';

export const NEPTUNE: BodySpec = {
  key: 'neptune',
  name: 'Neptune',
  type: 'planet',
  parent: 'sun',
  radiusKm: 24_764,
  flattening: 0.01708,
  spin: { poleRa: 299.36, poleDec: 43.46, w0: 253.18, wDot: 536.3128492 },
  color: 0x3f66c4,
  textures: { map: 'neptune.jpg' },
  atmosphere: {
    thicknessKm: 900,
    rayleigh: [0.22, 0.5, 1.0],
    mie: 0.28,
    // 11.1x Earth's column per bar, so 0.47 — a little under Uranus, because
    // `gravity` is 11.15 against 8.69. The two planets are near-twins in
    // composition, and their blues differ by rather more than that; the rest is
    // in the tints, where Neptune's is the deeper.
    density: 0.47,
    groundTint: [0.4, 0.6, 1.0],
  },
  rings: [
    {
      name: 'Galle, Le Verrier, Lassell, Arago',
      innerKm: 40_900,
      outerKm: 57_600,
      opacity: 0.05,
      exploreBoost: 220,
      exploreBrightness: 6,
      bands: [
        { name: 'Galle ring', innerKm: 40_900, outerKm: 42_900, tau: 1e-4, color: 0x4a3a33 },
        { name: '(empty)', innerKm: 42_900, outerKm: 53_150, tau: 0, color: 0x000000 },
        { name: 'Le Verrier ring', innerKm: 53_150, outerKm: 53_250, tau: 0.01, color: 0x5a453b },
        {
          name: 'Lassell ring (plateau)',
          innerKm: 53_250,
          outerKm: 57_200,
          tau: 1e-4,
          color: 0x4a3a33,
        },
        { name: 'Arago ring', innerKm: 57_200, outerKm: 57_300, tau: 1e-3, color: 0x5a453b },
      ],
    },
    {
      name: 'Adams ring',
      innerKm: 62_800,
      outerKm: 63_100,
      opacity: 0.12,
      exploreBoost: 220,
      exploreBrightness: 6,
      note: 'contains five bright dust arcs',
      bands: [
        {
          name: 'Adams ring',
          innerKm: 62_915,
          outerKm: 62_950,
          tau: 0.01,
          color: 0x5a453b,
          cause: 'arcs confined by a Galatea 42:43 resonance',
        },
      ],
    },
  ],
  facts: {
    mass: 1.02413e26,
    gravity: 11.15,
    escapeVelocity: 23.5,
    rotationHours: 16.11,
    axialTilt: 28.32,
    temperatureC: -200,
    albedo: 0.29,
    composition: 'H2/He/CH4 over a hot, dense water-ammonia mantle',
    discovered: '1846, Le Verrier, Galle and d’Arrest',
    blurb:
      'Found by mathematics before it was seen: predicted from irregularities in Uranus’s orbit and spotted within a degree of the prediction. Its winds reach 2,100 km/h, the fastest measured anywhere.',
  },
};
