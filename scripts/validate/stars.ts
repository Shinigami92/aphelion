/** The packed star catalogue. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEG, RAD } from '../../src/core/constants.ts';
import { STAR_CATALOGUE } from '../../src/data/generated/stars.ts';
import { unpackStars } from '../../src/data/stars.ts';
import { PUBLIC_DIR } from './assets.ts';
import { ok, section } from './harness.ts';

/** The catalogue entry nearest a published position. */
interface StarMatch {
  index: number;
  arcsec: number;
  mag: number;
  rgb: readonly [number, number, number];
  pm: number;
}

export function checkStarCatalogue(): void {
  section('Star catalogue');

  {
    // A sky renders convincingly whichever way round it is, so the checks that
    // matter are the ones a mirrored or mis-rotated catalogue cannot pass: named
    // stars at their published coordinates, in the right order of brightness,
    // with the right colours. Every reference value below is a published one,
    // typed in here rather than read back out of the file being checked.
    const file = path.join(PUBLIC_DIR, STAR_CATALOGUE.file);
    if (existsSync(file)) {
      const raw = readFileSync(file);
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      const stars = unpackStars(buf);

      ok('star catalogue unpacks', stars !== null, `${STAR_CATALOGUE.count} stars declared`);

      if (stars) {
        /** Nearest catalogue entry to a published position, and how far off it is. */
        const find = (raDeg: number, decDeg: number): StarMatch => {
          const ra = raDeg * DEG;
          const dec = decDeg * DEG;
          const t = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
          // The stored directions are equatorial J2000, the same frame as the
          // reference values, so this comparison never touches the obliquity.
          let best = -2;
          let index = -1;
          for (let i = 0; i < stars.count; i++) {
            const d =
              stars.direction[i * 3] * t[0] +
              stars.direction[i * 3 + 1] * t[1] +
              stars.direction[i * 3 + 2] * t[2];
            if (d > best) {
              best = d;
              index = i;
            }
          }
          // Angle from the chord, not from acos of the dot product. The stored
          // directions are float32, so 1 - dot carries only ~1e-7 of signal and
          // acos of it bottoms out around 90 arcseconds — which reads exactly
          // like a catalogue that is slightly wrong. The chord form has no such
          // cancellation and resolves to well under an arcsecond.
          const chord = Math.hypot(
            stars.direction[index * 3] - t[0],
            stars.direction[index * 3 + 1] - t[1],
            stars.direction[index * 3 + 2] - t[2],
          );
          return {
            index,
            arcsec: 2 * Math.asin(Math.min(1, chord / 2)) * RAD * 3600,
            mag: stars.magnitude[index],
            rgb: [
              stars.colour[index * 3],
              stars.colour[index * 3 + 1],
              stars.colour[index * 3 + 2],
            ] as const,
            pm: Math.hypot(
              stars.properMotion[index * 3],
              stars.properMotion[index * 3 + 1],
              stars.properMotion[index * 3 + 2],
            ),
          };
        };

        // RA/Dec J2000 and Johnson V, from the standard bright-star references.
        const NAMED: Array<[string, number, number, number]> = [
          ['Sirius', 101.28715, -16.71611, -1.46],
          ['Canopus', 95.98796, -52.69566, -0.74],
          ['Arcturus', 213.9153, 19.18241, -0.05],
          ['Vega', 279.23473, 38.78369, 0.03],
          ['Rigel', 78.63446, -8.20164, 0.13],
          ['Betelgeuse', 88.79293, 7.40706, 0.42],
          ['Aldebaran', 68.98016, 16.5093, 0.85],
          ['Antares', 247.35192, -26.432, 1.06],
          ['Deneb', 310.35798, 45.28034, 1.25],
          // Declination 89.26: the one that catches a pole-handling slip.
          ['Polaris', 37.95456, 89.26411, 1.98],
        ];

        let worstArcsec = 0;
        let worstMag = 0;
        for (const [name, ra, dec, vmag] of NAMED) {
          const hit = find(ra, dec);
          worstArcsec = Math.max(worstArcsec, hit.arcsec);
          worstMag = Math.max(worstMag, Math.abs(hit.mag - vmag));
          if (hit.arcsec > 60) {
            ok(`${name} is where it should be`, false, `nearest star is ${hit.arcsec.toFixed(0)}"`);
          }
        }
        // Right ascension is packed into a full turn of a uint16 and declination
        // into half a turn of an int16, so 11 arcseconds is the worst the packing
        // can be off; the rest is the difference between Hipparcos and whichever
        // reference the published value came from.
        ok(
          'ten named stars sit at their published positions',
          worstArcsec < 15,
          `worst ${worstArcsec.toFixed(1)}"`,
        );
        // Bright stars are frequently variable — Betelgeuse alone swings by half a
        // magnitude — so this is a check on the column, not on the photometry.
        ok(
          'and carry their published magnitudes',
          worstMag < 0.15,
          `worst ${worstMag.toFixed(3)} mag`,
        );

        // Colour: B stars must come out blue-white and M stars orange. Comparing
        // the blue/red ratio pins the direction of the B-V mapping, which a sign
        // slip would silently invert into a sky of red hot stars and blue cool ones.
        const rigel = find(78.63446, -8.20164).rgb;
        const betelgeuse = find(88.79293, 7.40706).rgb;
        ok(
          'Rigel is blue-white and Betelgeuse is orange',
          rigel[2] > rigel[0] && betelgeuse[0] > betelgeuse[2],
          `Rigel rgb(${rigel.join(',')}), Betelgeuse rgb(${betelgeuse.join(',')})`,
        );

        // Proper motion. The catalogue's own epoch is J1991.25 and these were
        // propagated forward to J2000, which is invisible on the sky as a whole
        // and glaring on the fastest movers. Groombridge 1830 is the fastest star
        // inside the magnitude limit, at 7.06"/yr — it travelled 62 arcseconds
        // between the two epochs, six times the packing quantum, so this fails
        // loudly if the propagation is ever dropped or applied twice.
        const groombridge = find(178.24487, 37.71868); // HD 103095, V 6.42
        ok(
          'Groombridge 1830 was propagated to J2000 and kept its proper motion',
          groombridge.arcsec < 15 && Math.abs(groombridge.pm * RAD * 3600 - 7.06) < 0.05,
          `${(groombridge.pm * RAD * 3600).toFixed(2)}"/yr, ${groombridge.arcsec.toFixed(1)}" from J2000`,
        );

        // Nothing in the file may be fainter than the limit the module advertises,
        // or the renderer's size law hands out negative radii.
        let faintest = -Infinity;
        for (let i = 0; i < stars.count; i++) {
          faintest = Math.max(faintest, stars.magnitude[i]);
        }
        ok(
          'no star is fainter than the declared limit',
          faintest <= STAR_CATALOGUE.magnitudeLimit + 1e-3,
          `faintest V ${faintest.toFixed(2)}, limit ${STAR_CATALOGUE.magnitudeLimit}`,
        );

        // Every direction must be a unit vector; the int16 packing is what would
        // break this, and a short vector renders as a star at the wrong distance
        // from the sphere's centre rather than as anything obviously wrong.
        let worstLength = 0;
        for (let i = 0; i < stars.count; i++) {
          const len = Math.hypot(
            stars.direction[i * 3],
            stars.direction[i * 3 + 1],
            stars.direction[i * 3 + 2],
          );
          worstLength = Math.max(worstLength, Math.abs(len - 1));
        }
        ok(
          'directions are unit vectors',
          worstLength < 1e-4,
          `worst |1-|v|| = ${worstLength.toExponential(1)}`,
        );

        // The Milky Way must actually be where the stars are dense. This is the
        // one check that ties the two layers of the sky together: it recomputes
        // the galactic pole from published values and asks whether the catalogue
        // crowds the plane it defines.
        const GNP_RA = 192.85948 * DEG;
        const GNP_DEC = 27.12825 * DEG;
        const pole = [
          Math.cos(GNP_DEC) * Math.cos(GNP_RA),
          Math.cos(GNP_DEC) * Math.sin(GNP_RA),
          Math.sin(GNP_DEC),
        ];
        let nearPlane = 0;
        for (let i = 0; i < stars.count; i++) {
          const sinB = Math.abs(
            stars.direction[i * 3] * pole[0] +
              stars.direction[i * 3 + 1] * pole[1] +
              stars.direction[i * 3 + 2] * pole[2],
          );
          if (sinB < Math.sin(10 * DEG)) {
            nearPlane++;
          }
        }
        // A band 10 degrees either side of the plane is 17.4% of the sky by area,
        // and a mirrored or mis-rotated catalogue would land on exactly that. The
        // excess is real but modest — everything down to eighth magnitude is
        // nearby, within a few disc scale heights, so the bright sky is far less
        // concentrated than the faint one that makes up the Milky Way.
        const fraction = nearPlane / stars.count;
        ok(
          'stars crowd the galactic plane',
          fraction > 0.22,
          `${(fraction * 100).toFixed(1)}% within 10 degrees of it, against 17.4% of the sky`,
        );
      }
    } else {
      ok('star catalogue present', false, `${STAR_CATALOGUE.file} is missing — run pnpm assets`);
    }
  }
}
