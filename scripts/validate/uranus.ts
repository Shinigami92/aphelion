/** The Uranian system and its photomosaics. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ScaleModel } from '../../src/core/scale.ts';
import { SolarSystem } from '../../src/core/system.ts';
import { decodePng, PUBLIC_DIR } from './assets.ts';
import { ok, section } from './harness.ts';

export function checkUranianSystem(): void {
  section('Uranian system');
  {
    // JPL Horizons state vectors, ecliptic J2000, km, relative to the planet's
    // centre at JD 2451544.5 TDB. Independent of the mean elements Aphelion
    // propagates and of the frame it propagates them in, which is the point:
    // reading JPL's "equatorial" satellite elements against Uranus's IAU north
    // pole rather than its rotational pole put all six inner moons on backwards
    // orbits, up to 1,092,551 km out, with every orbit normal exactly antiparallel
    // to Horizons'. Charon is the control — Pluto rotates prograde about its IAU
    // pole, so the Pluto system must not move.
    const HORIZONS: Record<string, [number, number, number]> = {
      Ariel: [116374.6, -4503.2, 151240.8],
      Umbriel: [238010.7, -66043.9, -100728.2],
      Titania: [89967.9, -78646.1, -418942.4],
      Oberon: [-520762.4, 77407.3, -251558.8],
      Miranda: [123174.8, -21566.4, -34602.5],
      Puck: [-71598.3, 22932.0, 42258.1],
      Charon: [-40.8, -10402.8, -16608.3],
    };
    const system = new SolarSystem();
    system.update(2451544.5, new ScaleModel());
    for (const [name, ref] of Object.entries(HORIZONS)) {
      const body = system.bodies.find((b) => b.key === `moon:${name}`);
      if (!body) {
        ok(`${name} exists`, false);
        continue;
      }
      const d = Math.hypot(
        body.localKm.x - ref[0],
        body.localKm.y - ref[1],
        body.localKm.z - ref[2],
      );
      // Mean elements, so the tolerance is set by how well they can do at all:
      // the classical moons land within 2,000 km and Puck, the innermost and the
      // fastest precessing, within 8,000. A frame error is six orders louder.
      const tol = name === 'Charon' ? 2000 : name === 'Puck' ? 12000 : 5000;
      ok(
        `${name} matches its Horizons position`,
        d < tol,
        `${Math.round(d)} km from JPL, tolerance ${tol} km`,
      );
    }

    // A satellite's IAU north is the end of its axis lying on its primary's north
    // side, so the rendered pole must too — that is what makes render longitude
    // equal IAU longitude and keeps every satellite map registered. Getting it
    // wrong is invisible on a procedural surface and turns a real map upside down
    // and mirrored, which is what had happened to Triton.
    let flipped = 0;
    let checked = 0;
    for (const body of system.bodies) {
      if (body.type !== 'moon' || !body.parent?.spec) {
        continue;
      }
      const p = body.parent.orientation.z;
      const z = body.orientation.z;
      checked++;
      if (z.x * p.x + z.y * p.y + z.z * p.z < 0) {
        flipped++;
      }
    }
    ok(
      'every satellite is oriented about its primary’s north side',
      flipped === 0,
      `${checked} satellites, ${flipped} inverted`,
    );
  }
}

// USGS I-1920 is a printed map sheet, so the whole conversion — the fitted
// polar-stereographic geometry, the direction longitude runs, the repair of
// the printed graticule — is checked against the IAU Gazetteer's published
// feature coordinates rather than trusted.
const probe = (file: string) => {
  const full = path.join(PUBLIC_DIR, 'textures', file);
  if (!existsSync(full)) {
    return null;
  }
  const img = decodePng(readFileSync(full));
  const px = (lat: number, lonEast: number): number => {
    const lon = ((((lonEast + 180) % 360) + 360) % 360) - 180;
    const x = Math.min(img.width - 1, Math.max(0, Math.round(((lon + 180) / 360) * img.width)));
    const y = Math.min(img.height - 1, Math.max(0, Math.round(((90 - lat) / 180) * img.height)));
    return img.data[(y * img.width + x) * img.channels];
  };
  // Average a small disc so no check turns on one pixel.
  const patch = (lat: number, lonEast: number): number => {
    let s = 0;
    let n = 0;
    const scale = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        s += px(lat + dy * 0.18, lonEast + (dx * 0.18) / scale);
        n++;
      }
    }
    return s / n;
  };
  const fill = img.data[0];
  let northImaged = 0;
  let southImaged = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const sample = img.data[(y * img.width + x) * img.channels];
      if (sample === fill) {
        continue;
      }
      if (y < img.height / 2) {
        northImaged++;
      } else {
        southImaged++;
      }
      sum += sample;
      n++;
    }
  }
  return { img, patch, northImaged, southImaged, mean: sum / Math.max(n, 1) };
};

export function checkUranianMosaics(): void {
  section('Uranian photomosaics');
  {
    for (const [body, file] of [
      ['Miranda', 'miranda.png'],
      ['Ariel', 'ariel.png'],
      ['Umbriel', 'umbriel.png'],
      ['Titania', 'titania.png'],
      ['Oberon', 'oberon.png'],
    ] as const) {
      const p = probe(file);
      if (!p) {
        continue;
      }
      ok(
        `${body} mosaic is a 2048x1024 equirectangular grey`,
        p.img.width === 2048 && p.img.height === 1024 && p.img.channels === 1,
        `${p.img.width}x${p.img.height}, ${p.img.channels} channel`,
      );
      // Voyager 2 arrived at southern summer solstice, so the northern hemisphere
      // is not merely sparse, it is entirely unobserved. It must be flat, and the
      // south must not be.
      const southFraction = p.southImaged / (p.img.width * (p.img.height / 2));
      ok(
        `${body} has an imaged south and a blank north`,
        p.northImaged === 0 && southFraction > 0.7,
        `north ${p.northImaged} imaged px, south ${(southFraction * 100).toFixed(0)}%`,
      );
    }

    // Registration, against the Gazetteer. Oberon's Hamlet and Macbeth are its
    // conspicuous dark-floored craters; mirroring the longitude convention lands
    // both on ordinary bright ground, which is what makes this a test of the
    // convention and not just of the darkness.
    const oberon = probe('oberon.png');
    if (oberon) {
      for (const [name, lat, lon, margin] of [
        ['Hamlet', -46.1, 44.4, 20],
        ['Macbeth', -58.4, 112.5, 50],
      ] as const) {
        const here = oberon.patch(lat, lon);
        const mirrored = oberon.patch(lat, -lon);
        ok(
          `Oberon's ${name} is a dark floor at its Gazetteer position`,
          here < oberon.mean - margin && here < mirrored - 15,
          `${here.toFixed(0)} against a mean of ${oberon.mean.toFixed(0)}, mirrored ${mirrored.toFixed(0)}`,
        );
      }
    }
    // Wunda is the brightest thing on Umbriel and the only feature on it anyone
    // can name from a picture.
    const umbriel = probe('umbriel.png');
    if (umbriel) {
      const wunda = umbriel.patch(-7.9, 273.6);
      ok(
        'Umbriel’s Wunda is the bright ring at its Gazetteer position',
        wunda > umbriel.mean + 20,
        `${wunda.toFixed(0)} against a mean of ${umbriel.mean.toFixed(0)}`,
      );
    }
  }
}
