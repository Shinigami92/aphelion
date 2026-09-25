/** Relief from global elevation grids: Mars, the Moon, Earth and Titan. */

import { reliefFor } from '../../src/data/generated/relief.ts';
import { SATELLITES } from '../../src/data/generated/satellites.ts';
import { lonApart } from './geometry.ts';
import { near, ok, section } from './harness.ts';
import { probeRelief } from './relief-probe.ts';

export function checkReliefGrids(): void {
  section('Surface relief');

  {
    const mars = probeRelief('mars');
    if (mars) {
      // Spot heights. Tolerances are wide because the grid is 4 px/deg — one
      // sample spans ~15 km — so these test registration, not altimetry.
      near('Ascraeus Mons elevation', mars.at(11.8, 255.5), 18.1, 1.5, ' km');
      near('Isidis basin floor', mars.at(12.9, 87.0), -3.8, 1.5, ' km');

      // The crustal dichotomy: the northern lowlands sit kilometres below the
      // southern highlands. Independent of any single landmark, and it fails loudly
      // if the grid is ever flipped in latitude.
      const north = mars.mean((lat) => lat > 40 && lat < 80);
      const south = mars.mean((lat) => lat < -40 && lat > -80);
      ok(
        'Mars northern lowlands sit below the southern highlands',
        south - north > 2,
        `north ${north.toFixed(2)} km, south ${south.toFixed(2)} km, difference ${(south - north).toFixed(2)} km`,
      );

      // The decisive one: the global extremes must land on the right features.
      const { hiAt, loAt } = mars.extremes();
      // Olympus Mons is 600 km across, so its highest sample sits a degree or so
      // off the nominal centre; 3 degrees still excludes every other volcano.
      ok(
        'Mars global maximum is Olympus Mons',
        Math.abs(hiAt[0] - 18.65) < 3 && lonApart(hiAt[1], 226.2) < 3,
        `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected 18.65N 226.2E`,
      );
      // Hellas is a 2,300 km basin, so the deepest sample roams within it.
      ok(
        'Mars global minimum is inside Hellas',
        loAt[0] > -50 && loAt[0] < -25 && loAt[1] > 45 && loAt[1] < 95,
        `at ${loAt[0].toFixed(2)}N ${loAt[1].toFixed(2)}E, expected the Hellas basin`,
      );
    } else {
      ok('mars relief (skipped, not on disk)', true);
    }
  }

  {
    const moon = probeRelief('moon:Moon');
    if (moon) {
      // The far side averages roughly 1.5-2 km higher than the near side. Being a
      // hemispheric property centred on 0 and 180 degrees, it pins the longitude
      // roll the way the crustal dichotomy pins latitude for Mars.
      const near1 = moon.mean((_lat, lon) => lonApart(lon, 0) < 75);
      const far = moon.mean((_lat, lon) => lonApart(lon, 180) < 75);
      ok(
        'lunar far side stands above the near side',
        far - near1 > 1,
        `near ${near1.toFixed(2)} km, far ${far.toFixed(2)} km, difference ${(far - near1).toFixed(2)} km`,
      );

      const { hiAt, loAt } = moon.extremes();
      ok(
        'lunar global maximum is on the far side',
        Math.abs(hiAt[0] - 5.4) < 6 && lonApart(hiAt[1], 201.4) < 6,
        `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected 5.4N 201.4E`,
      );
      // Antoniadi, inside the South Pole-Aitken basin — the lowest point on the Moon.
      ok(
        'lunar global minimum is inside South Pole-Aitken',
        loAt[0] < -60 && lonApart(loAt[1], 187.5) < 25,
        `at ${loAt[0].toFixed(2)}N ${loAt[1].toFixed(2)}E, expected 70.4S 187.5E`,
      );
    } else {
      ok('lunar relief (skipped, not on disk)', true);
    }
  }

  {
    const earth = probeRelief('earth');
    if (earth) {
      // Bathymetry is deliberately not displaced: over an ocean the visible
      // surface is the water. So nothing anywhere may sit below sea level, and
      // open ocean must read exactly zero.
      //
      // Note this does *not* extend to dry basins below sea level. A cell here is
      // about 19 km across — wider than the Dead Sea rift or Death Valley — so
      // averaging pulls in the surrounding highlands and both read positive. That
      // is the average being right, not the clamp being wrong.
      ok(
        'Earth relief never goes below sea level',
        (reliefFor('earth')?.minKm ?? -1) === 0,
        `declared minimum ${reliefFor('earth')?.minKm ?? 'missing'} km`,
      );
      ok(
        'Earth open ocean is exactly flat',
        earth.at(0, 200) === 0 && earth.at(0, 335) === 0 && earth.at(-60, 100) === 0,
        `Pacific ${earth.at(0, 200)}, Atlantic ${earth.at(0, 335)}, Southern ${earth.at(-60, 100)}`,
      );

      near('Tibetan plateau elevation', earth.at(32, 88), 4.9, 1.2, ' km');
      near('Altiplano elevation', earth.at(-20, 292), 3.7, 1.5, ' km');
      near('Sahara (Libya) elevation', earth.at(25, 20), 0.5, 0.5, ' km');

      // Averaged into 10.5 arc-minute cells no single summit survives, so the
      // maximum is the Himalaya-Karakoram wall rather than Everest itself.
      const { hiAt } = earth.extremes();
      ok(
        'Earth global maximum is the Himalaya',
        hiAt[0] > 25 && hiAt[0] < 40 && hiAt[1] > 70 && hiAt[1] < 100,
        `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected the Himalaya-Karakoram`,
      );
    } else {
      ok('Earth relief (skipped, not on disk)', true);
    }
  }

  {
    const titan = probeRelief('moon:Titan');
    if (titan) {
      // Titan's grid is the only one here that is an *interpolation* — a tensioned
      // spline through Cassini RADAR altimetry and SARTopo tracks that touched a
      // few percent of the surface — so its global extremes are artefacts of the
      // spline rather than named landmarks, and nothing below tests them. What can
      // be tested is what the published analysis of that data reports, plus one
      // number the map has no business knowing.
      //
      // Elevations are relative to the 2575.0 km sphere the product is published
      // against, 0.24 km above the radius Aphelion gives Titan. That is a uniform
      // change of sphere size rather than of shape, and leaving it alone is what
      // makes the mean-radius check below independent.
      const DATUM_KM = 2575.0;

      // Titan's poles sit several hundred metres below its equator: the single
      // most-cited result from this dataset, and it fails loudly on a flipped or
      // rolled grid because it is a property of latitude alone.
      const polar = titan.mean((lat) => Math.abs(lat) > 60);
      const equatorial = titan.mean((lat) => Math.abs(lat) < 30);
      ok(
        'Titan polar terrain sits below its equator',
        equatorial - polar > 0.3,
        `poles ${(polar * 1000).toFixed(0)} m, equator ${(equatorial * 1000).toFixed(0)} m,` +
          ` difference ${((equatorial - polar) * 1000).toFixed(0)} m`,
      );

      // The seas: Kraken, Ligeia and Punga at their Gazetteer centres, every one
      // of which has to be a hollow. Liquid pooling in topographic lows is physics
      // rather than a fitted parameter, and the three sit at three different
      // longitudes, so between them they pin the longitude roll the way the
      // far-side average pins it for the Moon.
      const globalMean = titan.mean(() => true);
      const seas: Array<[string, number, number]> = [
        ['Kraken Mare', 68.0, 50.0],
        ['Ligeia Mare', 79.7, 112.1],
        ['Punga Mare', 85.1, 20.3],
      ];
      for (const [name, lat, lonEast] of seas) {
        const depth = (globalMean - titan.at(lat, lonEast)) * 1000;
        ok(
          `${name} lies below Titan's mean surface`,
          depth > 300,
          `${depth.toFixed(0)} m below the global mean, expected more than 300`,
        );
      }

      // And the check the map cannot fudge: average its own elevations over the
      // sphere and Titan's mean radius falls out. JPL's figure comes from orbit
      // solutions and limb fits and knows nothing about RADAR altimetry, so two
      // numbers that have no common ancestor have to agree.
      const jpl = SATELLITES.find((s) => s.name === 'Titan')?.radius ?? NaN;
      near('Titan mean radius from its elevation grid', DATUM_KM + globalMean, jpl, 0.15, ' km');
    } else {
      ok('Titan relief (skipped, not on disk)', true);
    }
  }
}
