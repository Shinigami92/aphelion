/** Earth, with its night lights, clouds and oceans. */

import type { BodySpec } from '../body-spec.ts';

export const EARTH: BodySpec = {
  key: 'earth',
  name: 'Earth',
  type: 'planet',
  parent: 'sun',
  radiusKm: 6378.137,
  flattening: 1 / 298.257223563,
  spin: {
    poleRa: 0.0,
    poleRaDot: -0.641,
    poleDec: 90.0,
    poleDecDot: -0.557,
    w0: 190.147,
    wDot: 360.9856235,
  },
  color: 0x2b5c8a,
  textures: {
    map: 'earth_day.jpg',
    night: 'earth_night.jpg',
    clouds: 'earth_clouds.jpg',
    normal: 'earth_normal.jpg',
    specular: 'earth_specular.jpg',
  },
  // Mean zonal wind at roughly the level that steers the visible cloud deck
  // (~500 hPa), which is the thing a rigid shell cannot express: the trades
  // run *west* while the mid-latitude jets run east three times faster, and
  // it is that shear, not the mean, that makes an atmosphere read as one.
  // The southern jet is the stronger of the two because there are no
  // continents in the way — check any render at 50 S against 50 N.
  //
  // Cross-check on the magnitude, and a good one because it is independent.
  // Earth's relative atmospheric angular momentum is ~1.5e26 kg m^2/s, which
  // against a thin-shell (2/3)MR^2 = 1.39e32 is 1.08e-6 rad/s, or 6.9 m/s of
  // equivalent equatorial superrotation — 5.3 deg/day, which is what this
  // field held as a rigid drift before the profile replaced it. The mean the
  // renderer now pulls out of the profile is 6.7 deg/day, so the two routes
  // to the same quantity agree to about 25%. Both would have to be wrong
  // together for the deck to be turning at the wrong average rate.
  //            -90 -80 -70 -60 -50 -40 -30 -20 -10   0
  cloudWindMs: [
    0, 1, 6, 16, 20, 16, 8, -2, -5, -4,
    //             10  20 30 40 50 60 70 80  90
    -5, -3, 6, 14, 14, 11, 5, 1, 0,
  ],
  atmosphere: {
    thicknessKm: 100,
    rayleigh: [0.19, 0.45, 1.0],
    mie: 0.22,
    // Rayleigh optical depth at 440 nm. The standard sea-level column is
    // 0.0973 at 550 nm; scaled by lambda^-4 that is 0.237 at 440 and 0.049 at
    // 650, which is the tint above to two figures. Earth is the reference the
    // other eight are argued relative to.
    density: 0.23,
    groundTint: [1.0, 0.6, 0.35],
  },
  facts: {
    mass: 5.97237e24,
    gravity: 9.807,
    escapeVelocity: 11.186,
    rotationHours: 23.9344696,
    axialTilt: 23.4393,
    temperatureC: 15,
    albedo: 0.306,
    composition: '78% N2 / 21% O2 atmosphere, silicate mantle, iron-nickel core',
    discovered: 'n/a',
    blurb:
      'The only place known to have liquid water oceans, plate tectonics and life. Its unusually large moon stabilises the axial tilt, keeping the climate steadier than it would otherwise be.',
  },
};
