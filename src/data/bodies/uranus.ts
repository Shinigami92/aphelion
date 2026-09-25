/** Uranus and its narrow rings. */

import type { BodySpec } from '../body-spec.ts';

export const URANUS: BodySpec = {
  key: 'uranus',
  name: 'Uranus',
  type: 'planet',
  parent: 'sun',
  radiusKm: 25_559,
  flattening: 0.02293,
  spin: { poleRa: 257.311, poleDec: -15.175, w0: 203.81, wDot: -501.1600928 },
  color: 0x9fd8e0,
  textures: { map: 'uranus.jpg' },
  atmosphere: {
    thicknessKm: 900,
    rayleigh: [0.35, 0.8, 0.95],
    mie: 0.25,
    // The largest of the four, at 14.2x Earth's column per bar: `gravity` is
    // only 8.69 and the H2/He is heavier with methane mixed in. 0.60 at 440
    // nm. A deep clear Rayleigh layer over a distant cloud deck is exactly why
    // this planet is featureless cyan, so here the shell is the whole story.
    density: 0.6,
    groundTint: [0.6, 0.9, 0.95],
  },
  rings: [
    {
      name: 'Inner rings (6 through epsilon)',
      innerKm: 41_600,
      outerKm: 51_300,
      opacity: 1,
      exploreBoost: 6,
      exploreBrightness: 7,
      note: 'nine narrow, dark, sharply confined rings',
      // Among the darkest objects in the solar system — geometric albedo
      // around 0.03, charcoal rather than the tan of Saturn's ice. They are
      // also extraordinarily narrow: several are a couple of kilometres wide
      // across a 9,000 km span, which is why the profile is integrated per
      // texel rather than point-sampled. Epsilon is both the widest and the
      // most eccentric, running 20 km at periapse to 96 km at apoapse.
      bands: [
        { name: 'Ring 6', innerKm: 41_836, outerKm: 41_838, tau: 0.3, color: 0x2a2724 },
        { name: 'Ring 5', innerKm: 42_234, outerKm: 42_236, tau: 0.5, color: 0x2a2724 },
        { name: 'Ring 4', innerKm: 42_570, outerKm: 42_573, tau: 0.3, color: 0x2a2724 },
        { name: 'Alpha ring', innerKm: 44_714, outerKm: 44_722, tau: 0.4, color: 0x2e2b27 },
        { name: 'Beta ring', innerKm: 45_657, outerKm: 45_665, tau: 0.3, color: 0x2e2b27 },
        { name: 'Eta ring', innerKm: 47_175, outerKm: 47_177, tau: 0.25, color: 0x2a2724 },
        {
          name: 'Gamma ring',
          innerKm: 47_625,
          outerKm: 47_628,
          tau: 0.5,
          color: 0x2a2724,
          cause: 'confined by an Ophelia 6:5 resonance',
        },
        { name: 'Delta ring', innerKm: 48_298, outerKm: 48_303, tau: 0.4, color: 0x2a2724 },
        { name: 'Lambda ring', innerKm: 50_023, outerKm: 50_026, tau: 0.1, color: 0x333029 },
        {
          name: 'Epsilon ring',
          innerKm: 51_120,
          outerKm: 51_179,
          tau: 1.5,
          color: 0x38342e,
          cause: 'shepherded between Cordelia and Ophelia',
        },
      ],
    },
    {
      name: 'Outer rings (nu, mu)',
      innerKm: 66_100,
      outerKm: 103_000,
      opacity: 1,
      exploreBoost: 5,
      exploreBrightness: 2.5,
      note: 'dusty; mu peaks at the orbit of Mab',
      // The odd pair: nu is red like most dusty rings, while mu is blue —
      // the only other blue ring known besides Saturn's E ring, and for the
      // same reason, a small icy moon feeding it fresh sub-micron grains.
      bands: [
        { name: 'Nu ring', innerKm: 66_100, outerKm: 69_900, tau: 1e-5, color: 0x6b4b3c },
        { name: '(empty)', innerKm: 69_900, outerKm: 86_000, tau: 0, color: 0x000000 },
        {
          name: 'Mu ring',
          innerKm: 86_000,
          outerKm: 103_000,
          tau: 8e-6,
          color: 0x8fa8c4,
          cause: 'peaks at the orbit of Mab, its source',
        },
      ],
    },
  ],
  facts: {
    mass: 8.681e25,
    gravity: 8.69,
    escapeVelocity: 21.3,
    rotationHours: -17.24,
    axialTilt: 97.77,
    temperatureC: -195,
    albedo: 0.3,
    composition: 'H2/He envelope over a water-ammonia-methane "ice" mantle',
    discovered: '1781, William Herschel',
    blurb:
      'Tipped almost onto its side, so each pole spends 42 years in sunlight and 42 in darkness. The coldest atmosphere in the solar system, bottoming out at -224 C despite Neptune being further out.',
  },
};
