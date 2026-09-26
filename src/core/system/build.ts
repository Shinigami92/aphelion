/** Building the body tree from the catalogues: planets, satellites, minor planets, Lagrange points. */

import type { LagrangeId, RotatingPoint } from '../../astro/lagrange.ts';
import type { BodySpec } from '../../data/body-spec.ts';
import type { SmallBodyData } from '../../data/generated/smallbodies.ts';
import type { SimBody } from '../system.ts';
import { basisForFrame, basisForPlanetEquator } from '../../astro/frames.ts';
import { hillFraction, isCollinear, LAGRANGE_IDS, lagrangeGeometry } from '../../astro/lagrange.ts';
import { DWARF_PLANETS } from '../../data/bodies/dwarf-planets.ts';
import { MOON_NOTES, MOON_TEXTURES, MOON_TINTS } from '../../data/bodies/moons.ts';
import { SMALL_BODY_RADII, SMALL_BODY_TEXTURES } from '../../data/bodies/small-bodies.ts';
import { SATELLITES } from '../../data/generated/satellites.ts';
import { SMALL_BODIES } from '../../data/generated/smallbodies.ts';
import { GM, TWO_PI } from '../constants.ts';
import { capitalize, hasGm, makeBody } from './body.ts';
import {
  diameterFromMagnitude,
  GROUP_ALBEDO,
  GROUP_COLOR,
  GROUP_LABEL,
  LAGRANGE_NOTES,
  MARKER_HILL_FRACTION,
  romanFor,
} from './catalogue.ts';
import { elementsFromSatellite, elementsFromSmallBody } from './elements.ts';

/**
 * The collections a solar system is built into. `SolarSystem` is one; the builders
 * below only need these three.
 */
export interface BodyRegistry {
  readonly bodies: SimBody[];
  readonly byKey: Map<string, SimBody>;
  readonly lagrange: SimBody[];
}

function register(reg: BodyRegistry, body: SimBody, parent: SimBody | null): void {
  reg.bodies.push(body);
  reg.byKey.set(body.key, body);
  if (parent) {
    parent.children.push(body);
    body.depth = parent.depth + 1;
  }
}

export function addSpec(reg: BodyRegistry, spec: BodySpec, parent: SimBody | null): SimBody {
  const body = makeBody({
    key: spec.key,
    name: spec.name,
    type: spec.type,
    subtitle:
      spec.type === 'star'
        ? 'G2V main-sequence star'
        : spec.type === 'dwarf'
          ? 'dwarf planet'
          : 'planet',
    parent,
    radiusKm: spec.radiusKm,
    flattening: spec.flattening,
    spec,
    color: spec.color,
    textureFile: spec.textures?.map ?? null,
    note: null,
    minor: false,
  });
  register(reg, body, parent);
  return body;
}

export function addSatellites(reg: BodyRegistry): void {
  for (const sat of SATELLITES) {
    const parent = reg.byKey.get(sat.planet);
    if (!parent) {
      continue;
    }

    // JPL's "equatorial" frame means the *parent planet's* equator, not the
    // ICRF equator, and the table leaves the pole columns blank for those
    // rows. The data says so unambiguously: Titania and Charon are listed at
    // inclination 0.1 and 0.0 degrees, which is only true of Uranus's and
    // Pluto's own equators — against the ICRF equator they would be ~75 and
    // ~119 degrees. Reading it as the ICRF equator tipped all 11 affected
    // moons (the classical Uranians and the whole Pluto system) out of their
    // planet's plane, leaving Uranus's rings and its moons visibly
    // non-coplanar.
    //
    // Which *end* of that axis is not a free choice either, and it is not the
    // IAU pole: see `basisForPlanetEquator`. Reading it as the IAU pole had the
    // six inner Uranian moons orbiting backwards, up to 1.09 million km out.
    const basis =
      sat.frame === 'equatorial' && parent.spec
        ? basisForPlanetEquator(parent.spec.spin)
        : basisForFrame(sat.frame, sat.poleRa, sat.poleDec);
    const body = makeBody({
      key: `moon:${sat.name}`,
      name: sat.name,
      type: 'moon',
      subtitle: `${capitalize(sat.planet)} ${romanFor(sat.code)} — moon`,
      parent,
      radiusKm: sat.radius,
      flattening: 0,
      spec: null,
      color: MOON_TINTS[sat.planet] ?? 0x9a9a95,
      textureFile: MOON_TEXTURES[sat.name] ?? null,
      note: MOON_NOTES[sat.name] ?? null,
      minor: sat.radius < 100,
    });
    body.sat = sat;
    body.basis = basis;
    body.radiusEstimated = sat.radiusEstimated;
    body.elements = elementsFromSatellite(sat);
    body.periodDays = sat.period;
    register(reg, body, parent);
  }
}

export function addMinorPlanets(
  reg: BodyRegistry,
  sun: SimBody,
  smallByName: Map<string, SmallBodyData>,
): void {
  const dwarfNames = new Set(DWARF_PLANETS.map((d) => d.name));
  for (const sb of SMALL_BODIES) {
    // Dwarf planets already exist as fully specified bodies.
    if (dwarfNames.has(sb.name)) {
      continue;
    }
    // Charon and friends are satellites, not heliocentric minor planets.
    if (reg.byKey.has(`moon:${sb.name}`)) {
      continue;
    }
    void smallByName;

    const albedo = GROUP_ALBEDO[sb.group] ?? 0.1;
    const measured = SMALL_BODY_RADII[sb.name];
    const radius = measured ?? diameterFromMagnitude(sb.h, albedo) / 2;
    const body = makeBody({
      key: `sb:${sb.name}`,
      name: sb.name,
      type: 'asteroid',
      subtitle: GROUP_LABEL[sb.group] ?? sb.group,
      parent: sun,
      radiusKm: radius,
      flattening: 0,
      spec: null,
      color: GROUP_COLOR[sb.group] ?? 0x9a8e78,
      textureFile: SMALL_BODY_TEXTURES[sb.name] ?? null,
      note: null,
      minor: true,
    });
    body.small = sb;
    body.radiusEstimated = measured === undefined;
    body.elements = elementsFromSmallBody(sb);
    body.periodDays = TWO_PI / body.elements.n;
    register(reg, body, sun);
  }
}

/** One Lagrange point of a Sun-planet pair, as a body like any other. */
function lagrangePoint(
  sun: SimBody,
  planet: SimBody,
  id: LagrangeId,
  massRatio: number,
  hillKm: number,
  rotating: RotatingPoint,
): SimBody {
  const collinear = isCollinear(id);
  const body = makeBody({
    key: `lagrange:${planet.key}:${id}`,
    name: id,
    type: 'lagrange',
    subtitle: `Sun–${planet.name} Lagrange point`,
    parent: planet,
    radiusKm: hillKm / MARKER_HILL_FRACTION,
    flattening: 0,
    spec: null,
    // Warm for the three that need station-keeping, cool for the two that
    // collect Trojans — the one thing about them worth reading at a glance.
    color: collinear ? 0xffab6b : 0x74dfc0,
    textureFile: null,
    note: LAGRANGE_NOTES[`${planet.key}:${id}`] ?? null,
    minor: true,
  });
  body.lagrange = {
    id,
    primary: sun,
    secondary: planet,
    massRatio,
    rotating,
    hillKm,
    collinear,
  };
  // A 1:1 co-orbital: it goes round the Sun exactly as often as its planet.
  body.periodDays = planet.periodDays;
  body.depth = planet.depth + 1;
  return body;
}

/**
 * The five Lagrange points of each Sun-planet pair.
 *
 * Registered by hand rather than through `register`, because they must not
 * join `bodies` (see the field's comment) and must not join their planet's
 * `children` either: `children` is what the depth-first update order walks,
 * and a marker solved as if it were a satellite would be pushed through the
 * satellite scale remap and land somewhere it has no business being. Their
 * `parent` is still the planet, because that is the body every readout wants
 * to measure them against.
 *
 * Only the eight planets get them. The mass ratio of any dwarf planet is so
 * small that its points are indistinguishable from its own orbit, and nothing
 * is known to occupy them.
 */
export function addLagrangePoints(reg: BodyRegistry, sun: SimBody): void {
  for (const planet of sun.children) {
    if (planet.type !== 'planet' || !planet.spec || !planet.elements) {
      continue;
    }
    const gm = hasGm(planet.spec.key) ? GM[planet.spec.key] : undefined;
    if (gm === undefined) {
      continue;
    }

    // The planet's own GM, not the planet-plus-moons figure. It is the
    // geocentre that Aphelion draws and that the marker is placed against, so
    // this keeps the mass and the geometry describing the same body. For
    // Earth — the only case where it is even arguable — folding the Moon in
    // would move L1 and L2 outward by 0.4%, or 6,000 km in 1.5 million.
    const massRatio = gm / (GM.sun + gm);
    const geometry = lagrangeGeometry(massRatio);
    const hillKm = planet.elements.a * hillFraction(massRatio);

    for (const id of LAGRANGE_IDS) {
      const body = lagrangePoint(sun, planet, id, massRatio, hillKm, geometry[id]);
      reg.lagrange.push(body);
      reg.byKey.set(body.key, body);
    }
  }
}
