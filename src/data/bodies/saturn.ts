/** Saturn and its ring system. */

import type { BodySpec } from '../body-spec.ts';

export const SATURN: BodySpec = {
  key: 'saturn',
  name: 'Saturn',
  type: 'planet',
  parent: 'sun',
  radiusKm: 60_268,
  flattening: 0.09796,
  spin: {
    poleRa: 40.589,
    poleRaDot: -0.036,
    poleDec: 83.537,
    poleDecDot: -0.004,
    w0: 38.9,
    wDot: 810.7939024,
  },
  color: 0xd9c08a,
  textures: { map: 'saturn.jpg' },
  atmosphere: {
    thicknessKm: 1100,
    rayleigh: [0.75, 0.68, 0.5],
    mie: 0.45,
    // Same derivation as Jupiter's, and it comes out 2.4x larger for one
    // reason: `gravity` is 10.44 against Jupiter's 24.79, so the same pressure
    // holds that much more gas overhead. 12.7 * 0.18 * 0.237 = 0.54.
    density: 0.54,
    groundTint: [0.98, 0.92, 0.75],
  },
  rings: [
    {
      name: 'D ring',
      innerKm: 66_900,
      outerKm: 74_510,
      opacity: 1,
      exploreBoost: 3,
      exploreBrightness: 1.4,
      note: 'faint, innermost, almost touching the cloud tops',
      bands: [{ name: 'D ring', innerKm: 66_900, outerKm: 74_510, tau: 0.001, color: 0x8c8378 }],
    },
    {
      // Kept at the photometric strip's own registration: saturn_ring.png
      // spans exactly this range, so moving the edges would slide every
      // ringlet in it. The bands below cover the same span and stand in until
      // the image loads.
      name: 'Main rings (C, B, Cassini division, A, F)',
      innerKm: 74_500,
      outerKm: 140_220,
      texture: 'saturn_ring.png',
      opacity: 1.0,
      note: 'over 99% water ice, on average only ~10 m thick',
      // Boundaries from Voyager and Cassini occultations. The two colours
      // are real: the B ring's dense, fresh ice reads warm and tan, while the
      // sparse C ring and Cassini Division are greyer, being both thinner and
      // more contaminated. Every named gap here is cross-checked in
      // `pnpm validate` against the moon or resonance that clears it — if a
      // radius is wrong, its shepherd is no longer standing in it.
      bands: [
        { name: 'C ring', innerKm: 74_500, outerKm: 77_870, tau: 0.08, color: 0x9c9080 },
        {
          name: 'Colombo Gap (Titan Ringlet)',
          innerKm: 77_870,
          outerKm: 77_970,
          tau: 0,
          color: 0x9c9080,
          cause: 'Titan 1:0 apsidal resonance',
        },
        { name: 'C ring (outer)', innerKm: 77_970, outerKm: 87_491, tau: 0.1, color: 0x9c9080 },
        {
          name: 'Maxwell Gap',
          innerKm: 87_491,
          outerKm: 87_591,
          tau: 0,
          color: 0x9c9080,
          cause: 'a confined eccentric ringlet',
        },
        {
          name: 'C ring (outermost)',
          innerKm: 87_591,
          outerKm: 91_975,
          tau: 0.12,
          color: 0x9c9080,
        },
        { name: 'B ring (inner)', innerKm: 91_975, outerKm: 99_000, tau: 0.9, color: 0xc4ab8a },
        {
          name: 'B ring (central)',
          innerKm: 99_000,
          outerKm: 110_000,
          tau: 2.1,
          color: 0xd8c2a0,
        },
        { name: 'B ring (outer)', innerKm: 110_000, outerKm: 117_580, tau: 1.4, color: 0xcdb694 },
        {
          name: 'Huygens Gap',
          innerKm: 117_580,
          outerKm: 117_930,
          tau: 0,
          color: 0x9c9080,
          cause: 'Mimas 2:1 resonance, which also holds the B ring edge',
        },
        {
          name: 'Cassini Division',
          innerKm: 117_930,
          outerKm: 122_170,
          tau: 0.12,
          color: 0x9a8e7d,
          cause: 'cleared by the Mimas 2:1 resonance',
        },
        {
          name: 'A ring (inner)',
          innerKm: 122_170,
          outerKm: 133_424,
          tau: 0.62,
          color: 0xc0a98c,
        },
        {
          name: 'Encke Gap',
          innerKm: 133_424,
          outerKm: 133_749,
          tau: 0,
          color: 0xc0a98c,
          cause: 'swept clear by Pan, which orbits inside it',
        },
        { name: 'A ring (outer)', innerKm: 133_749, outerKm: 136_487, tau: 0.5, color: 0xc0a98c },
        {
          name: 'Keeler Gap',
          innerKm: 136_487,
          outerKm: 136_522,
          tau: 0,
          color: 0xc0a98c,
          cause: 'swept clear by Daphnis, which raises waves on its edges',
        },
        {
          name: 'A ring (edge)',
          innerKm: 136_522,
          outerKm: 136_775,
          tau: 0.45,
          color: 0xc0a98c,
          cause: 'outer edge held by the Janus/Epimetheus 7:6 resonance',
        },
        {
          name: 'Roche Division',
          innerKm: 136_775,
          outerKm: 139_380,
          tau: 0.002,
          color: 0x8c8378,
        },
        {
          name: 'F ring',
          innerKm: 140_140,
          outerKm: 140_220,
          tau: 0.1,
          color: 0xd5c7ae,
          cause: 'shepherded by Prometheus and Pandora',
        },
      ],
    },
    {
      name: 'E ring',
      innerKm: 180_000,
      outerKm: 480_000,
      opacity: 1,
      exploreBoost: 4,
      exploreBrightness: 1.4,
      note: 'fed by the plumes of Enceladus',
      bands: [
        {
          name: 'E ring (inner)',
          innerKm: 180_000,
          outerKm: 230_000,
          tau: 1e-6,
          color: 0xaebccc,
        },
        {
          name: 'E ring (peak)',
          innerKm: 230_000,
          outerKm: 250_000,
          tau: 1e-5,
          color: 0xc2d2e4,
          cause: 'densest at the orbit of Enceladus, its source',
        },
        {
          name: 'E ring (outer)',
          innerKm: 250_000,
          outerKm: 480_000,
          tau: 1e-6,
          color: 0xaebccc,
        },
      ],
    },
  ],
  facts: {
    mass: 5.6834e26,
    gravity: 10.44,
    escapeVelocity: 35.5,
    rotationHours: 10.656,
    axialTilt: 26.73,
    temperatureC: -140,
    albedo: 0.342,
    composition: '96% H2 / 3% He; mean density 0.687 g/cm3',
    discovered: 'prehistoric',
    blurb:
      'Less dense than water. Its rings span three quarters of the Earth-Moon distance yet are only about ten metres thick, and a persistent hexagonal jet stream circles the north pole.',
  },
};
