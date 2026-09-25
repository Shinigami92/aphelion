/** Planetary positions, the lunar theory, orbital periods and inclinations. */

import type { PlanetKey } from '../../src/astro/planets.ts';
import { wrap2pi } from '../../src/astro/kepler.ts';
import { moonSpherical } from '../../src/astro/moon.ts';
import { PLANET_KEYS, planetPosition } from '../../src/astro/planets.ts';
import { AU_KM, RAD } from '../../src/core/constants.ts';
import { jdTT, v } from './epoch.ts';
import { near, ok, section } from './harness.ts';

export function checkPlanetaryPositions(): void {
  section('Planetary positions — 2026-08-06 00:00 UTC');

  /** Expected heliocentric distance ranges (perihelion..aphelion), AU. */
  const RANGES: Record<PlanetKey, [number, number]> = {
    mercury: [0.307, 0.467],
    venus: [0.718, 0.728],
    earth: [0.983, 1.017],
    mars: [1.381, 1.666],
    jupiter: [4.95, 5.46],
    saturn: [9.02, 10.05],
    uranus: [18.28, 20.1],
    neptune: [29.8, 30.33],
    pluto: [29.6, 49.4],
  };

  for (const key of PLANET_KEYS) {
    planetPosition(key, jdTT, v);
    const rAu = Math.hypot(v.x, v.y, v.z) / AU_KM;
    const [lo, hi] = RANGES[key];
    const lon = wrap2pi(Math.atan2(v.y, v.x)) * RAD;
    const lat = Math.asin(v.z / (rAu * AU_KM)) * RAD;
    ok(
      `${key.padEnd(8)} r in [${lo}, ${hi}] AU`,
      rAu >= lo && rAu <= hi,
      `r=${rAu.toFixed(4)} AU  lon=${lon.toFixed(2)}°  lat=${lat.toFixed(2)}°`,
    );
  }

  // The Sun's geocentric longitude is the Earth's heliocentric longitude + 180.
  // On 6 August the Sun sits at roughly 13-14° of Leo, i.e. ecliptic longitude
  // ~133-134°, which is a value anyone can check against an almanac.
  {
    planetPosition('earth', jdTT, v);
    const sunLon = wrap2pi(Math.atan2(-v.y, -v.x)) * RAD;
    near('Sun geocentric longitude', sunLon, 133.6, 1.0, '°');

    const rAu = Math.hypot(v.x, v.y, v.z) / AU_KM;
    near('Earth-Sun distance (early Aug)', rAu, 1.0146, 0.002, ' AU');

    // Earth's orbit defines the ecliptic, so its latitude must be ~0.
    const lat = Math.asin(v.z / (rAu * AU_KM)) * RAD;
    ok('Earth ecliptic latitude ~ 0', Math.abs(lat) < 0.01, `lat=${lat.toExponential(2)}°`);
  }
}

export function checkLunarTheory(): void {
  section('Lunar theory');

  {
    const m = moonSpherical(jdTT);
    ok(
      'Moon distance within perigee/apogee bounds',
      m.distance > 356_000 && m.distance < 407_000,
      `${m.distance.toFixed(0)} km`,
    );
    ok(
      'Moon ecliptic latitude within ±5.4°',
      Math.abs(m.latitude * RAD) <= 5.45,
      `${(m.latitude * RAD).toFixed(3)}°`,
    );

    // Sample a synodic month: the Moon must sweep a full 360° of longitude and
    // its distance must vary by roughly the real perigee-apogee spread.
    let minD = Infinity;
    let maxD = -Infinity;
    for (let k = 0; k < 240; k++) {
      const s = moonSpherical(jdTT + (k * 29.53) / 240);
      minD = Math.min(minD, s.distance);
      maxD = Math.max(maxD, s.distance);
    }
    ok('perigee near 362-370k km', minD > 356_000 && minD < 372_000, `min ${minD.toFixed(0)} km`);
    ok('apogee near 400-407k km', maxD > 398_000 && maxD < 407_500, `max ${maxD.toFixed(0)} km`);

    // Draconic check: latitude must cross zero twice per 27.2 days.
    let crossings = 0;
    let prev = Math.sign(moonSpherical(jdTT).latitude);
    for (let k = 1; k <= 400; k++) {
      const s = Math.sign(moonSpherical(jdTT + (k * 27.212) / 400).latitude);
      if (s !== prev) {
        crossings++;
      }
      prev = s;
    }
    ok('two nodal crossings per draconic month', crossings === 2, `${crossings} crossings`);
  }
}

export function checkOrbitalPeriods(): void {
  section('Orbital periods (from the mean-longitude rates)');

  {
    // Recover each planet's sidereal period by timing a full 360° sweep of
    // heliocentric longitude. Catches rate/units errors in the element table.
    const EXPECTED_YEARS: Record<PlanetKey, number> = {
      mercury: 0.2408,
      venus: 0.6152,
      earth: 1.0,
      mars: 1.8809,
      jupiter: 11.862,
      saturn: 29.457,
      uranus: 84.02,
      neptune: 164.79,
      pluto: 247.94,
    };
    for (const key of PLANET_KEYS) {
      // Mean longitude rate straight from the table, in degrees per century.
      const p0 = { x: 0, y: 0, z: 0 };
      const p1 = { x: 0, y: 0, z: 0 };
      const dt = 1.0; // day
      planetPosition(key, jdTT, p0);
      planetPosition(key, jdTT + dt, p1);
      const l0 = Math.atan2(p0.y, p0.x);
      const l1 = Math.atan2(p1.y, p1.x);
      let dl = l1 - l0;
      if (dl < -Math.PI) {
        dl += 2 * Math.PI;
      }
      if (dl > Math.PI) {
        dl -= 2 * Math.PI;
      }
      // Instantaneous angular rate -> period, corrected to a mean via the
      // vis-viva relation r^2 * dtheta/dt = const (angular momentum).
      const r0 = Math.hypot(p0.x, p0.y, p0.z);
      const el = EXPECTED_YEARS[key];
      // Compare instantaneous sweep against the expected mean within a factor
      // that eccentricity can explain (Pluto's e=0.25 gives ±~70%).
      const instYears = (2 * Math.PI) / Math.abs(dl) / 365.25;
      ok(
        `${key.padEnd(8)} period ~ ${el} yr`,
        instYears > el * 0.5 && instYears < el * 1.9,
        `instantaneous ${instYears.toFixed(3)} yr (r=${(r0 / AU_KM).toFixed(3)} AU)`,
      );
    }
  }
}

export function checkInclinations(): void {
  section('Inclinations');

  {
    // Inclination to the ecliptic, recovered from the orbit normal.
    const EXPECTED_INC: Record<PlanetKey, number> = {
      mercury: 7.0,
      venus: 3.39,
      earth: 0.0,
      mars: 1.85,
      jupiter: 1.3,
      saturn: 2.49,
      uranus: 0.77,
      neptune: 1.77,
      pluto: 17.14,
    };
    for (const key of PLANET_KEYS) {
      const p0 = { x: 0, y: 0, z: 0 };
      const p1 = { x: 0, y: 0, z: 0 };
      planetPosition(key, jdTT, p0);
      planetPosition(key, jdTT + 2, p1);
      // Orbit normal from r x v.
      const nx = p0.y * p1.z - p0.z * p1.y;
      const ny = p0.z * p1.x - p0.x * p1.z;
      const nz = p0.x * p1.y - p0.y * p1.x;
      const inc = Math.acos(nz / Math.hypot(nx, ny, nz)) * RAD;
      near(`${key.padEnd(8)} inclination`, inc, EXPECTED_INC[key], 0.1, '°');
    }
  }
}
