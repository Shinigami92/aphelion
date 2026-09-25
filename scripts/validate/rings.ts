/** Rings: the shared scale remap, and their structure against the moons that shape it. */

import { ScaleModel } from '../../src/core/scale.ts';
import { SolarSystem } from '../../src/core/system.ts';
import { ALL_BODY_SPECS } from '../../src/data/bodies.ts';
import { jdTT } from './epoch.ts';
import { near, ok, section } from './harness.ts';

export function checkRingRemap(): void {
  section('Rings share the satellite scale remap');

  {
    // A ring is a population of orbiting bodies. If it is remapped by a different
    // law from the moons, the shepherds leave their gaps — which is exactly what
    // happened while rings scaled linearly and moons scaled by the power law:
    // Pan ended up 209 scene units from the Encke gap it orbits inside.
    //
    // Radii from Cassini, in km from Saturn's centre.
    const SATURN_R = 60_268;
    const ENCKE = 133_590;
    const KEELER = 136_505;
    const A_OUTER = 136_775;
    const F_RING = 140_180;
    // Orbital semi-major axes, JPL.
    const PAN = 133_584;
    const DAPHNIS = 136_504;
    const PROMETHEUS = 139_380;
    const PANDORA = 141_720;
    const MIMAS = 185_540;

    const scale = new ScaleModel();

    for (const mode of ['explore', 'true'] as const) {
      scale.setMode(mode);
      scale.snap();
      const at = (km: number): number => scale.satelliteDistance(km, SATURN_R);

      // The gap and the moonlet that clears it must be drawn together. Pan is
      // 20 km wide inside a 325 km gap, so the tolerance is a fraction of that.
      const enckeErr = Math.abs(at(PAN) - at(ENCKE));
      ok(
        `[${mode}] Pan is drawn inside the Encke gap`,
        enckeErr < at(A_OUTER) * 0.002,
        `${(enckeErr * 1000).toFixed(0)} km apart in scene terms`,
      );
      const keelerErr = Math.abs(at(DAPHNIS) - at(KEELER));
      ok(
        `[${mode}] Daphnis is drawn inside the Keeler gap`,
        keelerErr < at(A_OUTER) * 0.002,
        `${(keelerErr * 1000).toFixed(0)} km apart in scene terms`,
      );
      ok(
        `[${mode}] Prometheus and Pandora straddle the F ring`,
        at(PROMETHEUS) < at(F_RING) && at(F_RING) < at(PANDORA),
        `${at(PROMETHEUS).toFixed(1)} < ${at(F_RING).toFixed(1)} < ${at(PANDORA).toFixed(1)} units`,
      );
      ok(
        `[${mode}] Mimas orbits clear of the main rings`,
        at(MIMAS) > at(F_RING),
        `Mimas ${at(MIMAS).toFixed(1)} vs F ring ${at(F_RING).toFixed(1)} units`,
      );
    }

    // Below the knee the remap is the identity, which is what keeps Saturn's
    // silhouette right: the rings span 1.24 to 2.33 planet radii in reality and
    // must still do so on screen. A pure power law drew them at 72% of that.
    scale.setMode('explore');
    scale.snap();
    const renderedRadii = (km: number): number =>
      scale.satelliteDistance(km, SATURN_R) / scale.bodyRadius(SATURN_R);
    near(
      '[explore] C ring inner edge sits at its true 1.236 radii',
      renderedRadii(74_500),
      1.236,
      0.002,
    );
    near(
      '[explore] A ring outer edge sits at its true 2.270 radii',
      renderedRadii(A_OUTER),
      2.27,
      0.002,
    );

    // Monotone, or the model would reorder bodies — the one property the whole
    // scale scheme rests on. Sampled across the knee, where a kink lives.
    {
      let monotone = true;
      let previous = -Infinity;
      for (let km = 10_000; km <= 13_000_000; km += 10_000) {
        const d = scale.satelliteDistance(km, SATURN_R);
        if (d <= previous) {
          monotone = false;
        }
        previous = d;
      }
      ok('the satellite remap is monotone across the knee', monotone, '1,300 samples');
    }

    // True scale must be exactly 1:1, knee or no knee.
    scale.setMode('true');
    scale.snap();
    near(
      '[true] the remap is the identity',
      scale.satelliteDistance(A_OUTER, SATURN_R),
      A_OUTER / 1000,
      1e-6,
    );
  }
}

const bandOf = (planet: string, name: string): { innerKm: number; outerKm: number } | null => {
  const spec = ALL_BODY_SPECS.find((s) => s.key === planet);
  for (const ring of spec?.rings ?? []) {
    const band = ring.bands?.find((b) => b.name === name);
    if (band) {
      return band;
    }
  }
  return null;
};

/** Where an m:n mean-motion resonance with a moon falls, by Kepler's third. */
const resonance = (axisKm: number, inner: number, outer: number): number =>
  axisKm * Math.pow(inner / outer, 2 / 3);

export function checkRingStructure(): void {
  section('Ring structure against the bodies that shape it');

  {
    // The ring table is checked against the *satellite* table, which comes from
    // JPL elements and knows nothing about rings. A gap radius and the moon that
    // clears it are then two independent numbers that have to agree — so a typo
    // in a ring boundary cannot pass unnoticed, and no ring number is taken on
    // trust alone.
    const system = new SolarSystem();
    const scale = new ScaleModel();
    system.update(jdTT, scale);

    /** Semi-major axis of a moon, km, from the loaded satellite elements. */
    const moonAxis = (planet: string, name: string): number | null => {
      const parent = system.byKey.get(planet);
      const moon = parent?.children.find((c) => c.name === name);
      return moon?.elements ? moon.elements.a : null;
    };

    // -- gaps holding the moonlet that swept them -----------------------------
    for (const [gap, moon] of [
      ['Encke Gap', 'Pan'],
      ['Keeler Gap', 'Daphnis'],
    ] as const) {
      const band = bandOf('saturn', gap);
      const axis = moonAxis('saturn', moon);
      if (!band || axis === null) {
        ok(`${moon} sits inside the ${gap}`, false, 'missing band or moon');
        continue;
      }
      ok(
        `${moon} orbits inside the ${gap}`,
        axis > band.innerKm && axis < band.outerKm,
        `${moon} at ${axis.toFixed(0)} km, gap ${band.innerKm}-${band.outerKm} km`,
      );
    }

    // -- edges held by a resonance --------------------------------------------
    {
      // Mimas 2:1 is the classic: it holds the B ring's outer edge and is why the
      // Cassini Division is empty at all.
      const mimas = moonAxis('saturn', 'Mimas');
      const huygens = bandOf('saturn', 'Huygens Gap');
      if (mimas !== null && huygens) {
        const at = resonance(mimas, 1, 2);
        ok(
          'the B ring edge sits at the Mimas 2:1 resonance',
          Math.abs(at - huygens.innerKm) < huygens.innerKm * 0.01,
          `resonance at ${at.toFixed(0)} km, B ring edge ${huygens.innerKm} km`,
        );
      }
      // Janus/Epimetheus 7:6 holds the A ring's outer edge.
      const janus = moonAxis('saturn', 'Janus');
      const aEdge = bandOf('saturn', 'A ring (edge)');
      if (janus !== null && aEdge) {
        const at = resonance(janus, 6, 7);
        ok(
          'the A ring edge sits at the Janus/Epimetheus 7:6 resonance',
          Math.abs(at - aEdge.outerKm) < aEdge.outerKm * 0.01,
          `resonance at ${at.toFixed(0)} km, A ring edge ${aEdge.outerKm} km`,
        );
      }
    }

    // -- shepherded rings ------------------------------------------------------
    {
      const f = bandOf('saturn', 'F ring');
      const pro = moonAxis('saturn', 'Prometheus');
      const pan = moonAxis('saturn', 'Pandora');
      if (f && pro !== null && pan !== null) {
        ok(
          'Prometheus and Pandora straddle the F ring band',
          pro < f.innerKm && pan > f.outerKm,
          `${pro.toFixed(0)} < ${f.innerKm}-${f.outerKm} < ${pan.toFixed(0)} km`,
        );
      }
      const eps = bandOf('uranus', 'Epsilon ring');
      const cor = moonAxis('uranus', 'Cordelia');
      const oph = moonAxis('uranus', 'Ophelia');
      if (eps && cor !== null && oph !== null) {
        ok(
          'Cordelia and Ophelia straddle the epsilon ring',
          cor < eps.innerKm && oph > eps.outerKm,
          `${cor.toFixed(0)} < ${eps.innerKm}-${eps.outerKm} < ${oph.toFixed(0)} km`,
        );
      }
      const mu = bandOf('uranus', 'Mu ring');
      const mab = moonAxis('uranus', 'Mab');
      if (mu && mab !== null) {
        ok(
          'Mab orbits inside the mu ring it feeds',
          mab > mu.innerKm && mab < mu.outerKm,
          `Mab at ${mab.toFixed(0)} km, ring ${mu.innerKm}-${mu.outerKm} km`,
        );
      }
      const adams = bandOf('neptune', 'Adams ring');
      const galatea = moonAxis('neptune', 'Galatea');
      if (adams && galatea !== null) {
        ok(
          'Galatea orbits just inside the Adams ring it confines',
          galatea < adams.innerKm && galatea > adams.innerKm - 2000,
          `Galatea at ${galatea.toFixed(0)} km, ring at ${adams.innerKm} km`,
        );
      }
      const enc = bandOf('saturn', 'E ring (peak)');
      const enceladus = moonAxis('saturn', 'Enceladus');
      if (enc && enceladus !== null) {
        ok(
          'the E ring peaks at the orbit of Enceladus, its source',
          enceladus > enc.innerKm && enceladus < enc.outerKm,
          `Enceladus at ${enceladus.toFixed(0)} km, peak ${enc.innerKm}-${enc.outerKm} km`,
        );
      }
    }

    // -- the bands must tile their ring, in order and without overlap ---------
    {
      let broken: string[] = [];
      for (const spec of ALL_BODY_SPECS) {
        for (const ring of spec.rings ?? []) {
          if (!ring.bands) {
            continue;
          }
          let previous = -Infinity;
          for (const band of ring.bands) {
            if (band.innerKm >= band.outerKm || band.innerKm < previous) {
              broken.push(`${spec.key}:${band.name}`);
            }
            if (band.innerKm < ring.innerKm - 1 || band.outerKm > ring.outerKm + 1) {
              broken.push(`${spec.key}:${band.name} outside its ring`);
            }
            previous = band.outerKm;
          }
        }
      }
      ok(
        'every ring band is ordered and inside its ring',
        broken.length === 0,
        broken.length > 0 ? broken.join(', ') : 'all ring systems',
      );
    }
  }
}
