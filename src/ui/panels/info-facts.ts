/**
 * What the info panel says about a body, as key/value rows.
 *
 * Pure: every builder reads a body (and for the live rows, the system and the
 * camera range) and returns rows. The panel owns the DOM they are written into.
 */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import { escapeVelocity } from '../../core/system/physics.ts';
import { RELIEF_EXAGGERATION } from '../../data/bodies/relief.ts';
import { reliefFor } from '../../data/generated/relief.ts';
import {
  fmt,
  formatDistance,
  formatDuration,
  formatHours,
  formatLightTime,
  formatMass,
} from './format.ts';

/** Label, value, and whether the value may wrap. A row with an empty value is skipped. */
export type FactRow = [string, string, boolean?];

/**
 * A Lagrange point's own facts.
 *
 * It shares no field with a body: it has no mass, no radius, no surface and
 * no orbit of its own, so the "Physical" and "Orbit" sections are filled from
 * the *pair* instead. The nominal radius the camera frames it by is
 * deliberately not shown — it is a viewing convention, and printing it as a
 * measurement is exactly the kind of convincing-but-wrong number this panel
 * exists to avoid.
 */
export function lagrangePhysicalRows(body: SimBody): FactRow[] {
  const info = body.lagrange!;
  const planet = info.secondary;
  return [
    ['Point', `${info.id} of ${info.primary.name}–${planet.name}`],
    ['Family', info.collinear ? 'collinear' : 'triangular (equilateral)'],
    [
      'Stability',
      info.collinear
        ? 'unstable — a spacecraft here must station-keep'
        : 'stable — material collects and stays',
      true,
    ],
    ['Mass ratio', `μ = ${info.massRatio.toExponential(3)}`],
    [`Hill radius of ${planet.name}`, formatDistance(info.hillKm)],
  ];
}

/** The orbit section of a Lagrange point: how it rides with its pair. */
export function lagrangeOrbitRows(body: SimBody): FactRow[] {
  const info = body.lagrange!;
  const planet = info.secondary;
  return [
    // Not "orbits": it is carried round by the pair, one turn for one turn of
    // the planet, which is the whole reason the configuration holds together.
    ['Co-orbits with', planet.name],
    ['Period', formatDuration(body.periodDays)],
    [
      'Geometry',
      info.collinear
        ? `on the ${info.primary.name}–${planet.name} line`
        : `60° ${info.id === 'L4' ? 'ahead of' : 'behind'} ${planet.name}, equidistant from both`,
      true,
    ],
    ['Solved for', 'the circular restricted three-body problem', true],
  ];
}

/** Mass and what follows from it, from whichever catalogue this body came from. */
function massRows(body: SimBody): FactRow[] {
  const rows: FactRow[] = [];
  const facts = body.spec?.facts;
  const radius = body.radiusKm;
  if (facts) {
    rows.push(
      ['Mass', formatMass(facts.mass)],
      ['Surface gravity', `${facts.gravity.toFixed(2)} m/s²`],
      ['Escape velocity', `${facts.escapeVelocity.toFixed(2)} km/s`],
      ['Rotation', formatHours(facts.rotationHours)],
      ['Axial tilt', `${facts.axialTilt.toFixed(2)}°`],
      ['Mean temperature', `${fmt(facts.temperatureC, 0)} °C`],
      ['Albedo', facts.albedo.toFixed(3)],
    );
  } else if (body.sat) {
    if (body.sat.gm !== null && body.sat.gm > 0) {
      // Mass from GM, and gravity/escape velocity from GM and radius.
      const massKg = (body.sat.gm * 1e9) / 6.6743e-11;
      rows.push(
        ['Mass', formatMass(massKg)],
        ['Surface gravity', `${((body.sat.gm / (radius * radius)) * 1000).toFixed(3)} m/s²`],
        ['Escape velocity', `${escapeVelocity(body.sat.gm, radius).toFixed(3)} km/s`],
      );
    }
    if (body.sat.density !== null && body.sat.density !== 0) {
      rows.push(['Density', `${body.sat.density.toFixed(3)} g/cm³`]);
    }
    rows.push(['Rotation', 'tidally locked']);
  } else if (body.small) {
    rows.push(
      ['Absolute magnitude', `H = ${body.small.h.toFixed(2)}`],
      // Only say "from H" when it really is: a body with a measured radius
      // (SMALL_BODY_RADII) is no longer being sized by its brightness.
      [body.radiusEstimated ? 'Diameter (from H)' : 'Diameter', `${fmt(radius * 2, 0)} km`],
    );
  }
  return rows;
}

/** The physical section of a body: size, shape, relief, mass, rotation. */
export function physicalRows(body: SimBody): FactRow[] {
  const rows: FactRow[] = [];

  const radius = body.radiusKm;
  rows.push(['Mean radius', `${fmt(radius, radius < 100 ? 2 : 1)} km`]);
  if (body.flattening > 0.001) {
    rows.push(
      ['Polar radius', `${fmt(radius * (1 - body.flattening), 1)} km`],
      ['Flattening', `1 / ${fmt(1 / body.flattening, 1)}`],
    );
  }
  // Terrain that has been exaggerated has to say so. The surface is real
  // measured topography, but at explore scale its vertical scale is not, and
  // an unlabelled 12x mountain is precisely the kind of convincing-but-wrong
  // this project keeps having to guard against.
  const relief = reliefFor(body.key);
  if (relief) {
    const factor = RELIEF_EXAGGERATION[body.key] ?? 1;
    rows.push([
      'Relief',
      factor > 1
        ? `${relief.credit.split('—')[0].trim()}, ×${factor} in explore scale`
        : relief.credit.split('—')[0].trim(),
      true,
    ]);
  }
  rows.push(...massRows(body));
  return rows;
}

/** The orbit section of a body: what it orbits, the elements, discovery, moons. */
export function orbitRows(body: SimBody): FactRow[] {
  const rows: FactRow[] = [];
  const elements = body.elements;

  if (body.parent) {
    rows.push(['Orbits', body.parent.name]);
  }
  if (body.periodDays) {
    rows.push(['Orbital period', formatDuration(body.periodDays)]);
  }
  if (elements) {
    rows.push(
      ['Semi-major axis', formatDistance(elements.a)],
      ['Eccentricity', elements.e.toFixed(5)],
      ['Inclination', `${((elements.i * 180) / Math.PI).toFixed(3)}°`],
      ['Periapsis', formatDistance(elements.a * (1 - elements.e))],
      ['Apoapsis', formatDistance(elements.a * (1 + elements.e))],
    );
    if (body.sat?.frame) {
      rows.push([
        'Reference plane',
        body.sat.frame === 'laplace'
          ? 'local Laplace plane'
          : body.sat.frame === 'equatorial'
            ? 'ICRF equator'
            : 'ecliptic J2000',
      ]);
    }
  }
  const discovered = body.spec?.facts.discovered;
  if (discovered !== undefined && discovered !== '' && discovered !== 'n/a') {
    rows.push(['Discovered', discovered, true]);
  }
  const moons = body.children.filter((c) => c.type === 'moon').length;
  if (moons) {
    rows.push(['Known moons', String(moons)]);
  }
  return rows;
}

/** Distance and light time from Earth, for anything that is not Earth. */
function earthRows(system: SolarSystem, body: SimBody): FactRow[] {
  const rows: FactRow[] = [];
  const earth = system.byKey.get('earth');
  if (earth && body !== earth) {
    const dx = body.helioKm.x - earth.helioKm.x;
    const dy = body.helioKm.y - earth.helioKm.y;
    const dz = body.helioKm.z - earth.helioKm.z;
    const d = Math.hypot(dx, dy, dz);
    // The parent row above has already given this distance for anything that
    // belongs to Earth — the Moon, and all five Lagrange points — so only the
    // light time, which it does not carry, is added on top. Printing the same
    // figure twice under two headings reads as a bug even when both are right.
    if (body.parent !== earth) {
      rows.push(['Distance from Earth', formatDistance(d)]);
    }
    rows.push(['Light travel from Earth', formatLightTime(d)]);
  }
  return rows;
}

/**
 * Live values that change every frame.
 *
 * `cameraDistanceKm` is a true distance in both scale modes and
 * `cameraRadii` the same figure in radii of the focused body — see
 * `CameraRange` in app/camera-range.ts for why the raw scene distance will not do.
 */
export function liveRows(
  system: SolarSystem,
  body: SimBody,
  focus: SimBody,
  cameraDistanceKm: number,
  cameraRadii: number,
): FactRow[] {
  const rows: FactRow[] = [];
  const sunKm = system.distanceToSun(body);
  if (body.type !== 'star') {
    rows.push(
      ['Distance from Sun', formatDistance(sunKm)],
      ['Light travel from Sun', formatLightTime(sunKm)],
    );
  }
  if (body.parent && body.parent.type !== 'star') {
    const localKm = Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z);
    rows.push([`Distance from ${body.parent.name}`, formatDistance(localKm)]);
  }
  rows.push(...earthRows(system, body));
  if (body.parent) {
    const speed = system.speedKmS(body);
    if (speed > 0) {
      rows.push(['Orbital speed', `${speed.toFixed(3)} km/s`]);
    }
  }
  // The camera orbits the focused body, which is not always the selected one:
  // select Titan while orbiting Saturn and a "camera distance" on Titan's
  // panel would be quietly wrong.
  if (body === focus) {
    rows.push(['Camera distance', formatDistance(cameraDistanceKm)]);
    // A Lagrange point has no surface to be above and no radius to be
    // measured in, so it gets the distance and nothing else. Its `radiusKm`
    // is only the scale the camera frames it by.
    if (body.type !== 'lagrange') {
      const altitude = cameraDistanceKm - body.radiusKm;
      if (altitude > 0) {
        rows.push(['Camera altitude', formatDistance(altitude)]);
      }
      rows.push(['Camera range', `${cameraRadii.toFixed(2)} × radius`]);
    }
  }

  return rows;
}
