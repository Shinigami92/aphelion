/** The apsidal precession of the irregular moons, prograde and retrograde. */

import { positionFromAngles } from '../../src/astro/kepler.ts';
import { elementsFromSatellite } from '../../src/core/system/elements.ts';
import { SATELLITES } from '../../src/data/generated/satellites.ts';
import { dot } from './geometry.ts';
import { ok, section } from './harness.ts';

export function checkIrregularApsides(): void {
  section('Irregular moon apsides');
  {
    // Direction of periapsis at 2010-01-01 TDB, a decade after the elements'
    // epoch, ecliptic J2000, relative to Jupiter. Each is the eccentricity
    // vector of JPL Horizons' osculating elements averaged over one orbital
    // period either side (20-day steps), which strips out the short-period
    // solar terms that swing a single osculating ω by tens of degrees.
    //
    // Position is the wrong thing to compare here: a few per cent of error in
    // the mean period moves these moons tens of millions of kilometres in a
    // decade whatever the precession does. The apse line is what the precession
    // rate moves, and JPL's tabulated periods carry no sign, so this is the check
    // that the sign is right. Precessing the retrograde moons' apsides backwards
    // puts them 76–141° off here, against 2–20° for the right sign. Himalia and
    // Elara are the prograde controls.
    const HORIZONS: Record<string, [number, number, number]> = {
      Himalia: [0.7, 0.709, -0.083],
      Elara: [0.078, -0.994, 0.08],
      Pasiphae: [-0.658, 0.679, -0.325],
      Sinope: [0.634, -0.746, 0.204],
      Carme: [0.176, 0.957, 0.229],
      Ananke: [0.336, -0.827, 0.45],
    };
    const jd = 2455197.5;
    const tol = 30;
    for (const [name, ref] of Object.entries(HORIZONS)) {
      const sat = SATELLITES.find((s) => s.name === name);
      if (!sat) {
        ok(`${name} exists`, false);
        continue;
      }
      const el = elementsFromSatellite(sat);
      const dt = jd - el.epoch;
      const node = el.node + (el.nodeDot ?? 0) * dt;
      const argPeri = el.argPeri + (el.argPeriDot ?? 0) * dt;
      // A unit circle evaluated at zero anomaly is the unit vector to periapsis.
      const p = positionFromAngles(1, 0, el.i, node, argPeri, 0, { x: 0, y: 0, z: 0 });
      const off =
        (Math.acos(Math.min(1, dot(p, { x: ref[0], y: ref[1], z: ref[2] }))) * 180) / Math.PI;
      ok(
        `${name}'s apse line matches Horizons a decade on`,
        off < tol,
        `${off.toFixed(1)}° from JPL, tolerance ${tol}°`,
      );
    }
  }
}
