/** The regular moons against JPL Horizons, well away from the elements' epoch. */

import { ScaleModel } from '../../src/core/scale.ts';
import { SolarSystem } from '../../src/core/system.ts';
import { ok, section } from './harness.ts';

export function checkRegularMoons(): void {
  section('Regular moons');
  {
    // JPL Horizons state vectors, ecliptic J2000, km, relative to the planet's
    // centre at JD 2456256.725 TDB (2012-12-01), 12.9 years after the elements'
    // epoch and on none of the dates `pnpm assets` fits them to. JPL's table put
    // Titan 2.39 million km out at the epoch itself, and read P and the precession
    // periods in a way that left Dione, Ariel, Io and Europa on the far side of
    // their orbits within a decade. Ganymede and Callisto are the controls: their
    // rows were right all along and must not move.
    //
    // Mean elements can do no better than a few per cent of the orbit here, and
    // Phobos, whose orbit is decaying, not quite that. The failure this catches
    // is fifty times larger.
    const HORIZONS: Record<string, [number, number, number]> = {
      Phobos: [3724.8, 8572.1, -1138.0],
      Deimos: [19325.1, 10251.1, -8458.0],
      Io: [-222095.6, 356897.6, 9823.8],
      Europa: [-540543.4, 407934.3, 11972.6],
      Ganymede: [488177.4, 952604.7, 42094.7],
      Callisto: [-1822803.2, -519843.5, -41059.0],
      Tethys: [32394.6, -258100.6, 138385.9],
      Dione: [-305715.7, 207611.6, -78939.9],
      Rhea: [-525555.1, 16580.1, 41775.6],
      Titan: [812815.7, -803517.5, 334180.3],
      Iapetus: [3396416.8, -182821.8, -640311.9],
      Ariel: [-186539.5, 40985.3, 1182.3],
      Umbriel: [167906.4, -63882.6, -197420.9],
      Titania: [-424890.5, 86097.0, -50942.0],
      Oberon: [-530989.7, 82756.5, -230003.9],
      Miranda: [54758.5, -5861.2, 117406.3],
    };
    const system = new SolarSystem();
    system.update(2456256.725, new ScaleModel());
    for (const [name, ref] of Object.entries(HORIZONS)) {
      const body = system.bodies.find((b) => b.key === `moon:${name}`);
      if (!body?.sat) {
        ok(`${name} exists`, false);
        continue;
      }
      const d = Math.hypot(
        body.localKm.x - ref[0],
        body.localKm.y - ref[1],
        body.localKm.z - ref[2],
      );
      const tol = (name === 'Phobos' ? 0.1 : 0.03) * body.sat.a;
      ok(
        `${name} matches its Horizons position 13 years on`,
        d < tol,
        `${Math.round(d)} km from JPL, tolerance ${Math.round(tol)} km`,
      );
    }
  }
}
