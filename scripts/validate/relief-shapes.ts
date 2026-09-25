/** Relief from shape models: Phobos, Deimos, and each model read back in its IAU frame. */

import { lonApart } from './geometry.ts';
import { ok } from './harness.ts';
import { probeRelief } from './relief-probe.ts';

export function checkShapeModels(): void {
  {
    const phobos = probeRelief('moon:Phobos');
    if (phobos) {
      // Offsets are measured from the mean radius the app gives Phobos.
      const R = 11.08;
      const r = (lat: number, lon: number): number => R + phobos.at(lat, lon);

      // The IAU triaxial figure is 13.0 x 11.4 x 9.1 km with the long axis locked
      // toward Mars. Reading it back off the resampled map confirms the cube-quad
      // conversion kept the model's own axes.
      ok(
        'Phobos long axis lies along the sub-Mars meridian',
        r(0, 0) > 12 && r(0, 180) > 12,
        `sub-Mars ${r(0, 0).toFixed(2)} km, anti-Mars ${r(0, 180).toFixed(2)} km, expected > 12`,
      );
      ok(
        'Phobos intermediate axis lies at 90 degrees',
        r(0, 90) > 11 && r(0, 90) < 12.4,
        `${r(0, 90).toFixed(2)} km, expected 11-12.4`,
      );
      ok(
        'Phobos short axis is polar',
        r(89, 0) < 10.4 && r(-89, 0) < 10.4,
        `north ${r(89, 0).toFixed(2)} km, south ${r(-89, 0).toFixed(2)} km, expected < 10.4`,
      );

      // Stickney is centred at 1N 49W, on the Mars-facing hemisphere. Comparing it
      // with the point diametrically opposite in longitude cancels the ellipsoid —
      // both sit the same distance round from the long axis — so what is left is
      // the crater. If the map were ever rolled half a turn, this flips sign.
      ok(
        'Stickney is a depression on the Mars-facing hemisphere',
        r(1, 131) - r(1, 311) > 0.4,
        `Stickney ${r(1, 311).toFixed(2)} km vs opposite ${r(1, 131).toFixed(2)} km`,
      );
    } else {
      ok('Phobos shape (skipped, not on disk)', true);
    }
  }

  {
    const deimos = probeRelief('moon:Deimos');
    if (deimos) {
      const R = 6.2;
      const r = (lat: number, lon: number): number => R + deimos.at(lat, lon);

      // IAU figure is 7.8 x 6.0 x 5.1 km, long axis locked toward Mars. The source
      // is a 5 degree Viking grid, so these are loose — they test that the table's
      // latitude order and longitude origin survived resampling, not the fit.
      ok(
        'Deimos long axis lies along the sub-Mars meridian',
        r(0, 0) > 6.8 && r(0, 180) > 6.8,
        `sub-Mars ${r(0, 0).toFixed(2)} km, anti-Mars ${r(0, 180).toFixed(2)} km, expected > 6.8`,
      );
      ok(
        'Deimos short axis is polar',
        r(89, 0) < 5.8 && r(-89, 0) < 5.8,
        `north ${r(89, 0).toFixed(2)} km, south ${r(-89, 0).toFixed(2)} km, expected < 5.8`,
      );
      // A broad, well-sampled depression in the southern hemisphere — 472 of the
      // table's 2701 points sit below 4.5 km, centred here. If the latitude order
      // were ever flipped this would appear in the north instead.
      ok(
        'Deimos southern depression is in the south',
        r(-67, 232) < 4.2 && r(67, 232) > 5,
        `south ${r(-67, 232).toFixed(2)} km, north ${r(67, 232).toFixed(2)} km`,
      );
    } else {
      ok('Deimos shape (skipped, not on disk)', true);
    }
  }

  {
    // Every shape model here is stored in its body's own IAU frame, so reading a
    // known figure back out of the resampled map is what proves the conversion
    // kept the axes — the same test applied to Phobos and Deimos above.
    const shaped: Array<[string, number, string]> = [
      ['moon:Mimas', 198.2, 'Mimas'],
      ['moon:Tethys', 531.1, 'Tethys'],
      ['moon:Dione', 561.4, 'Dione'],
      ['moon:Phoebe', 106.5, 'Phoebe'],
      ['sb:Eros', 8.42, 'Eros'],
      ['sb:Vesta', 262.7, 'Vesta'],
    ];
    for (const [key, ref, name] of shaped) {
      const p = probeRelief(key);
      if (!p) {
        ok(`${name} shape (skipped, not on disk)`, true);
        continue;
      }
      const r = (lat: number, lon: number): number => ref + p.at(lat, lon);

      if (name === 'Mimas') {
        // Herschel is 139 km across on a 198 km moon and 10 km deep — easily the
        // deepest point, and its position pins the longitude convention exactly.
        const { loAt } = p.extremes();
        ok(
          'Mimas deepest point is Herschel',
          Math.abs(loAt[0]) < 10 && lonApart(loAt[1], 249) < 10,
          `at ${loAt[0].toFixed(0)}N ${loAt[1].toFixed(0)}E, expected 0N 249E`,
        );
      }

      if (name === 'Eros') {
        // 34 x 11 x 11 km. Nothing else in the app is this elongated.
        ok(
          'Eros long axis is four times its waist',
          r(0, 0) > 13 && r(0, 180) > 13 && r(0, 90) < 8,
          `ends ${r(0, 0).toFixed(1)}/${r(0, 180).toFixed(1)} km, waist ${r(0, 90).toFixed(1)} km`,
        );
      }

      if (name === 'Vesta') {
        // Rheasilvia excavated most of the southern hemisphere; the north-south
        // asymmetry is the single most obvious thing about Vesta's figure.
        const north = p.mean((lat) => lat > 50);
        const south = p.mean((lat) => lat < -50);
        ok(
          'Vesta southern hemisphere is excavated by Rheasilvia',
          north - south > 8,
          `north ${(ref + north).toFixed(1)} km, south ${(ref + south).toFixed(1)} km`,
        );
      }

      if (name === 'Phoebe') {
        // A captured body that never relaxed: its radius varies by a quarter.
        const { hiAt, loAt } = p.extremes();
        const spread = (r(hiAt[0], hiAt[1]) - r(loAt[0], loAt[1])) / ref;
        ok(
          'Phoebe is strongly irregular',
          spread > 0.2,
          `radius spread ${(spread * 100).toFixed(0)}% of the mean`,
        );
      }

      if (name === 'Tethys' || name === 'Dione') {
        // Synchronous rotation raises a tidal bulge along the planet-facing axis,
        // so both ends of the prime meridian stand above the 90 degree flanks.
        const ends = (r(0, 0) + r(0, 180)) / 2;
        const flanks = (r(0, 90) + r(0, 270)) / 2;
        ok(
          `${name} is elongated toward Saturn`,
          ends > flanks,
          `ends ${ends.toFixed(1)} km, flanks ${flanks.toFixed(1)} km`,
        );
      }
    }
  }
}
