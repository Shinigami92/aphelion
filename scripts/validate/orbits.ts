/** Orbit lines, Lagrange points, and orbit geometry in float32. */

import type { SimBody } from '../../src/core/system.ts';
import { PLANET_KEYS } from '../../src/astro/planets.ts';
import { AU_KM } from '../../src/core/constants.ts';
import { ScaleModel } from '../../src/core/scale.ts';
import { SolarSystem } from '../../src/core/system.ts';
import { jdTT } from './epoch.ts';
import { near, ok, section } from './harness.ts';

export function checkRenderableOrbits(): void {
  section('Renderable planetary orbits');

  {
    const system = new SolarSystem();
    const scale = new ScaleModel();
    system.update(jdTT, scale);

    const missing: string[] = [];
    for (const key of PLANET_KEYS) {
      const body = system.byKey.get(key);
      const orbit = body ? system.orbitPolyline(body, scale, 128) : null;
      if (!body?.elements || !orbit || orbit.length !== (128 + 1) * 3) {
        missing.push(key);
      }
    }
    ok(
      'all planets and Pluto expose renderable orbit polylines',
      missing.length === 0,
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
    );
  }
}

const norm = (vec: { x: number; y: number; z: number }): number => Math.hypot(vec.x, vec.y, vec.z);

export function checkLagrangePoints(): void {
  section('Lagrange points');

  {
    const system = new SolarSystem();
    const scale = new ScaleModel();
    scale.setMode('true');
    scale.snap();
    system.update(jdTT, scale);

    ok(
      'every planet has five points, and no dwarf or minor body does',
      system.lagrange.length === 40,
      `${system.lagrange.length} points over ${new Set(system.lagrange.map((p) => p.lagrange!.secondary.key)).size} planets`,
    );
    ok(
      'they stay out of the body catalogue',
      system.bodies.every((b) => b.type !== 'lagrange'),
      'nothing that loops over bodies has to special-case a massless marker',
    );

    const point = (planet: string, id: string): SimBody =>
      system.byKey.get(`lagrange:${planet}:${id}`)!;

    for (const key of ['earth', 'jupiter', 'neptune'] as const) {
      const planet = system.byKey.get(key)!;
      const R = norm(planet.helioKm);

      // L4 and L5 are the apexes of equilateral triangles on the Sun and the
      // planet. That is exact — no solver involved — so any deviation is a frame
      // error, and it is the cheapest possible check on the rotating basis.
      for (const id of ['L4', 'L5'] as const) {
        const p = point(key, id);
        near(
          `${key.padEnd(8)} ${id} is one orbit radius from the Sun`,
          norm(p.helioKm) / R,
          1,
          1e-9,
        );
        near(
          `${key.padEnd(8)} ${id} is one orbit radius from the planet`,
          norm(p.localKm) / R,
          1,
          1e-9,
        );
      }

      // ...and L4 leads. Getting this backwards puts Jupiter's L4 marker in the
      // middle of the Trojan camp instead of the Greek one, and nothing else on
      // screen looks any different — so it is checked against the direction of
      // travel itself rather than against a longitude convention.
      const along = (p: SimBody): number =>
        p.localKm.x * planet.velKm.x + p.localKm.y * planet.velKm.y + p.localKm.z * planet.velKm.z;
      ok(
        `${key.padEnd(8)} L4 leads the planet and L5 trails`,
        along(point(key, 'L4')) > 0 && along(point(key, 'L5')) < 0,
      );

      // The collinear three lie on the Sun-planet line: sunward, anti-sunward and
      // beyond the Sun. Measured as a direction cosine, so an out-of-plane slip
      // shows up as well as a radial one.
      const cosine = (p: SimBody): number => {
        const d = norm(p.localKm);
        return (
          -(
            p.localKm.x * planet.helioKm.x +
            p.localKm.y * planet.helioKm.y +
            p.localKm.z * planet.helioKm.z
          ) /
          (d * R)
        );
      };
      near(`${key.padEnd(8)} L1 lies sunward of the planet`, cosine(point(key, 'L1')), 1, 1e-9);
      near(`${key.padEnd(8)} L2 lies anti-sunward`, cosine(point(key, 'L2')), -1, 1e-9);
      near(`${key.padEnd(8)} L3 lies beyond the Sun`, cosine(point(key, 'L3')), 1, 1e-9);

      // L3's distance from the barycentre is the classical R(1 + 5mu/12). This is
      // an independent result — it comes out of a series expansion, not out of the
      // quintic the solver bisects — so agreeing to a part in a thousand says the
      // root really is the root and not a nearby plausible number.
      const mu = point(key, 'L3').lagrange!.massRatio;
      const barycentre = R * mu;
      near(
        `${key.padEnd(8)} L3 sits at R(1 + 5mu/12) from the barycentre`,
        (norm(point(key, 'L3').helioKm) + barycentre) / R,
        1 + (5 * mu) / 12,
        Math.max(1e-12, mu * 1e-2),
      );
    }

    // The one figure everybody knows: JWST is 1.5 million km beyond Earth, and
    // SOHO sits about the same distance the other way.
    //
    // Quoted at a separation of exactly 1 AU, which is where the textbook number
    // comes from — the configuration breathes with Earth's eccentricity, so the
    // live distance is 1.5% larger in July than in January, and comparing that
    // against a constant would be testing the date rather than the geometry.
    {
      const earth = system.byKey.get('earth')!;
      const atOneAu = (id: string): number =>
        (norm(point('earth', id).localKm) * AU_KM) / norm(earth.helioKm) / 1e6;
      near(
        'Sun–Earth L1 is 1.49 million km sunward, at 1 AU',
        atOneAu('L1'),
        1.4916,
        0.005,
        ' Mkm',
      );
      near('Sun–Earth L2 is 1.50 million km out, at 1 AU', atOneAu('L2'), 1.5015, 0.005, ' Mkm');
    }

    // The collinear points are *near* the Hill radius, not at it — that is the
    // whole reason this module bisects a quintic instead of taking a cube root.
    // The gap is a function of the mass ratio alone, so it is checked against the
    // instantaneous separation rather than the semi-major axis the stored
    // `hillKm` uses; otherwise this measures where Jupiter happens to be today.
    for (const [key, expected] of [
      ['earth', 0.9966],
      ['jupiter', 0.977],
    ] as const) {
      const planet = system.byKey.get(key)!;
      const l1 = point(key, 'L1');
      const hillNow = norm(planet.helioKm) * Math.cbrt(l1.lagrange!.massRatio / 3);
      near(
        `${key.padEnd(8)} L1 sits just inside the Hill radius, not on it`,
        norm(l1.localKm) / hillNow,
        expected,
        0.0005,
      );
    }

    // Every collinear point must satisfy the equation that defines it: the
    // gradient of the effective potential vanishes there. Evaluated from the
    // stored geometry rather than from the solver's own working, so a solver that
    // returned a confident wrong answer would still fail here.
    {
      let worst = 0;
      for (const p of system.lagrange) {
        const info = p.lagrange!;
        if (!info.collinear) {
          continue;
        }
        const x = info.rotating.x;
        const mu = info.massRatio;
        const d1 = x + mu;
        const d2 = x - 1 + mu;
        const residual =
          x - ((1 - mu) * d1) / (Math.abs(d1) * d1 * d1) - (mu * d2) / (Math.abs(d2) * d2 * d2);
        worst = Math.max(worst, Math.abs(residual));
      }
      ok(
        'all 24 collinear points are stationary points of the effective potential',
        worst < 1e-9,
        `worst |dU/dx| = ${worst.toExponential(2)}`,
      );
    }

    // The scale remap must treat them as the heliocentric objects they are.
    // Pushing them through the satellite law instead would leave L4 — a full
    // orbit radius from its planet — sitting in the planet's lap, and it would no
    // longer land on the planet's own drawn orbit.
    {
      const explore = new ScaleModel();
      explore.setMode('explore');
      explore.snap();
      system.update(jdTT, explore);
      const earth = system.byKey.get('earth')!;
      const l4 = point('earth', 'L4');
      near(
        'explore scale keeps L4 on Earth’s own orbit circle',
        norm(l4.scene) / norm(earth.scene),
        1,
        1e-6,
      );
      ok(
        'explore scale keeps L1 clear of the enlarged planet',
        norm(l4.scene) > 0 &&
          Math.hypot(
            point('earth', 'L1').scene.x - earth.scene.x,
            point('earth', 'L1').scene.y - earth.scene.y,
            point('earth', 'L1').scene.z - earth.scene.z,
          ) >
            earth.sceneRadius * 4,
        `${(
          Math.hypot(
            point('earth', 'L1').scene.x - earth.scene.x,
            point('earth', 'L1').scene.y - earth.scene.y,
            point('earth', 'L1').scene.z - earth.scene.z,
          ) / earth.sceneRadius
        ).toFixed(1)} enlarged Earth radii away`,
      );
    }
  }
}

export function checkFloat32Orbits(): void {
  section('Orbit geometry survives float32');

  {
    // Satellite orbit vertices must be stored relative to their parent. Storing
    // absolute scene coordinates quantises the curve: at Pluto's ~1.28 million
    // scene units the float32 spacing is 0.085 units while Charon's orbit is only
    // ~40 across, which showed up as a visible sawtooth. Raising the segment count
    // cannot fix that, so this asserts the property rather than the appearance.
    const system = new SolarSystem();
    const scale = new ScaleModel();
    system.update(jdTT, scale);

    const charon = system.byKey.get('moon:Charon');
    const pluto = system.byKey.get('pluto');
    const segments = 512;
    const points = charon ? system.orbitPolyline(charon, scale, segments) : null;

    if (!points || !pluto) {
      ok('Charon orbit polyline available', false);
    } else {
      const parentMagnitude = Math.hypot(pluto.scene.x, pluto.scene.y, pluto.scene.z);

      let maxCoord = 0;
      let minR = Infinity;
      let maxR = -Infinity;
      for (let i = 0; i < segments; i++) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const z = points[i * 3 + 2];
        maxCoord = Math.max(maxCoord, Math.abs(x), Math.abs(y), Math.abs(z));
        const r = Math.hypot(x, y, z);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
      }
      const meanR = (minR + maxR) / 2;
      const relativeSpread = (maxR - minR) / meanR;

      ok(
        'satellite orbit vertices are parent-relative, not absolute',
        maxCoord < parentMagnitude * 0.01,
        `max |coord| ${maxCoord.toFixed(2)} vs parent at ${parentMagnitude.toFixed(0)}`,
      );
      // A circular orbit sampled in eccentric anomaly has constant radius, so any
      // spread here is quantisation. Charon's eccentricity is ~0, and the bound is
      // still far tighter than the 0.3% the absolute-coordinate version produced.
      ok(
        'radial quantisation below 0.01% of the orbit radius',
        relativeSpread < 1e-4,
        `spread ${(relativeSpread * 100).toFixed(5)}% of ${meanR.toFixed(3)} units`,
      );
    }
  }
}
