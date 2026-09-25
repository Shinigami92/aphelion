/** Venus, under its cloud deck. */

import type { BodySpec } from '../body-spec.ts';

export const VENUS: BodySpec = {
  key: 'venus',
  name: 'Venus',
  type: 'planet',
  parent: 'sun',
  radiusKm: 6051.8,
  flattening: 0,
  spin: { poleRa: 272.76, poleDec: 67.16, w0: 160.2, wDot: -1.4813688 },
  color: 0xe8cfa0,
  textures: { map: 'venus_surface.jpg', clouds: 'venus_atmosphere.jpg' },
  // Superrotation, the largest such effect in the solar system: the cloud
  // tops circle the planet in about 4.2 days while the crust takes 243, both
  // retrograde. -360/4.2 = -85.71 deg/day for the deck, of which the crust
  // already supplies -1.48, so the shell makes up the remaining -84.23.
  // Without this Venus is the one planet whose headline fact — that it turns
  // slower than it orbits — is contradicted by what the screen shows, since
  // the only thing visible on it is the deck.
  cloudDriftDegPerDay: -84.23,
  atmosphere: {
    thicknessKm: 250,
    rayleigh: [0.9, 0.75, 0.45],
    mie: 0.9,
    // The upper haze above the cloud tops, tau ~= 0.05-0.5 measured. Not the
    // clouds themselves: their tau is 20-40, and they are already drawn from
    // venus_atmosphere.jpg. Using the cloud figure here would render Venus as
    // a blown-out white ball and throw that texture away.
    density: 0.5,
    groundTint: [1.0, 0.85, 0.55],
  },
  facts: {
    mass: 4.8675e24,
    gravity: 8.87,
    escapeVelocity: 10.36,
    rotationHours: -5832.5,
    axialTilt: 177.36,
    temperatureC: 464,
    albedo: 0.76,
    composition: '96.5% CO2 atmosphere at 92 bar, basaltic surface',
    discovered: 'prehistoric',
    blurb:
      'Rotates backwards, once every 243 days — slower than its 225-day year. A runaway greenhouse keeps the surface at 464 C everywhere, day or night, pole or equator.',
  },
};
