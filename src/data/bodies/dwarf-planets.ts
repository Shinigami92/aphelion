/**
 * The dwarf planets.
 *
 * Pluto keeps a full spec because we render its satellite system; the others
 * are driven by the Minor Planet Center elements in data/generated and only
 * need physical/visual properties here.
 */

import type { BodySpec } from '../body-spec.ts';

export const DWARF_PLANETS: BodySpec[] = [
  {
    key: 'pluto',
    name: 'Pluto',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 1188.3,
    flattening: 0,
    spin: { poleRa: 132.993, poleDec: -6.163, w0: 302.695, wDot: 56.3625225 },
    color: 0xc4a68a,
    textures: { map: 'pluto.jpg' },
    // The New Horizons mosaic we bundle is LORRI panchromatic. This restores
    // Pluto's measured global colour over real detail; see ATTRIBUTION.md.
    textureTint: 0xffd8b4,
    atmosphere: {
      thicknessKm: 50,
      rayleigh: [0.5, 0.55, 0.7],
      mie: 0.6,
      // Optically thin — New Horizons put the haze at tau ~ 0.01-0.1 in the blue
      // — and yet it produced the most famous image of the encounter, because it
      // was shot at a phase angle of 166 degrees. That is the forward-scattering
      // lobe doing the work, not the optical depth, which is why this is the one
      // body here where `mie` outweighs a `density` this small.
      density: 0.06,
      groundTint: [0.7, 0.75, 0.85],
    },
    facts: {
      mass: 1.303e22,
      gravity: 0.62,
      escapeVelocity: 1.21,
      rotationHours: -153.2928,
      axialTilt: 122.53,
      temperatureC: -229,
      albedo: 0.52,
      composition: 'Nitrogen-ice surface over a large rocky core; ~70% rock by mass',
      discovered: '1930, Clyde Tombaugh',
      blurb:
        'Mutually tidally locked with Charon, the two orbiting a barycentre outside Pluto’s surface. New Horizons found nitrogen-ice glaciers flowing across Sputnik Planitia and mountains of water ice 3 km high.',
    },
  },
  {
    key: 'ceres',
    name: 'Ceres',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 469.7,
    flattening: 0.075,
    spin: { poleRa: 291.418, poleDec: 66.764, w0: 170.65, wDot: 952.1532 },
    color: 0x8a8378,
    textures: { map: 'ceres.jpg' },
    facts: {
      mass: 9.3839e20,
      gravity: 0.28,
      escapeVelocity: 0.51,
      rotationHours: 9.074,
      axialTilt: 4,
      temperatureC: -105,
      albedo: 0.09,
      composition: 'Hydrated silicates over a possible briny subsurface layer',
      discovered: '1801, Giuseppe Piazzi',
      blurb:
        'The largest object in the asteroid belt and the only dwarf planet inside Neptune’s orbit, holding about a third of the belt’s entire mass. The bright spots in Occator crater are sodium carbonate left by escaping brine.',
    },
  },
  {
    key: 'eris',
    name: 'Eris',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 1163,
    flattening: 0,
    spin: { poleRa: 0, poleDec: 90, w0: 0, wDot: 22.6 },
    color: 0xd8d2c8,
    textures: { map: 'eris.jpg' },
    facts: {
      mass: 1.6466e22,
      gravity: 0.82,
      escapeVelocity: 1.38,
      rotationHours: 15.79,
      axialTilt: 78,
      temperatureC: -231,
      albedo: 0.96,
      composition: 'Methane-ice frost over rock; among the most reflective bodies known',
      discovered: '2005, Brown, Trujillo and Rabinowitz',
      blurb:
        'Slightly more massive than Pluto, and the discovery that forced the IAU to define "planet" in 2006. Currently near aphelion at 96 AU, its atmosphere frozen flat onto the surface.',
    },
  },
  {
    key: 'haumea',
    name: 'Haumea',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 816,
    // Spins so fast it is a triaxial ellipsoid, roughly 2100 x 1680 x 1074 km.
    flattening: 0.49,
    spin: { poleRa: 285, poleDec: -12, w0: 0, wDot: 1057.9 },
    color: 0xe0ded8,
    textures: { map: 'haumea.jpg' },
    facts: {
      mass: 4.006e21,
      gravity: 0.4,
      escapeVelocity: 0.91,
      rotationHours: 3.9155,
      axialTilt: 126,
      temperatureC: -241,
      albedo: 0.51,
      composition: 'Crystalline water ice over a rocky interior',
      discovered: '2004, Ortiz et al. / Brown et al.',
      blurb:
        'Rotates once every 3.9 hours — so fast it has been stretched into a rugby-ball shape twice as long as it is thick. It has two moons and the only ring system known around a trans-Neptunian object.',
    },
  },
  {
    key: 'makemake',
    name: 'Makemake',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 715,
    flattening: 0,
    spin: { poleRa: 0, poleDec: 90, w0: 0, wDot: 31.3 },
    color: 0xc9a086,
    textures: { map: 'makemake.jpg' },
    facts: {
      mass: 3.1e21,
      gravity: 0.5,
      escapeVelocity: 0.8,
      rotationHours: 22.83,
      axialTilt: 0,
      temperatureC: -239,
      albedo: 0.81,
      composition: 'Methane and ethane ices, reddened by irradiation',
      discovered: '2005, Michael Brown et al.',
      blurb:
        'The second-brightest Kuiper belt object after Pluto. Its surface carries centimetre-sized methane ice grains, unusually large, and a single dark moon was found in 2016.',
    },
  },
];
