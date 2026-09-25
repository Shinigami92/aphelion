/**
 * The solar system as a simulated body tree.
 *
 * Builds one `SimBody` per object — Sun, planets, 459 satellites, dwarf planets
 * and 221 catalogued minor planets — and recomputes every position and
 * orientation for a given instant. Kept free of Three.js so the physics can be
 * validated independently of the renderer; the render layer reads `scene`,
 * `sceneRadius` and `orientation` off each body and does nothing else.
 *
 * Two position spaces per body:
 *   - `helioKm` / `localKm`: the real, unscaled geometry in kilometres.
 *   - `scene`: the same geometry after the active `ScaleModel` remapping.
 *
 * Angles and directions are identical in both; only radial distances differ.
 *
 * Building the tree and solving it each frame live in system/; this file keeps
 * the body record and the `SolarSystem` that owns the collections.
 */

import type { Basis } from '../astro/frames.ts';
import type { Elements, Vec3 } from '../astro/kepler.ts';
import type { LagrangeId, RotatingPoint } from '../astro/lagrange.ts';
import type { BodySpec, BodyType } from '../data/body-spec.ts';
import type { SatelliteData } from '../data/generated/satellites.ts';
import type { SmallBodyData } from '../data/generated/smallbodies.ts';
import type { ScaleModel } from './scale.ts';
import { applyBasis } from '../astro/frames.ts';
import { sampleOrbit } from '../astro/kepler.ts';
import { planetOrbitElements } from '../astro/planets.ts';
import { centuriesSinceJ2000, daysSinceJ2000 } from '../astro/timescales.ts';
import { PLANETS, SUN } from '../data/bodies.ts';
import { DWARF_PLANETS } from '../data/bodies/dwarf-planets.ts';
import { SMALL_BODIES } from '../data/generated/smallbodies.ts';
import { TWO_PI } from './constants.ts';
import { isPlanetKey, length } from './system/body.ts';
import { addLagrangePoints, addMinorPlanets, addSatellites, addSpec } from './system/build.ts';
import { elementsFromSmallBody } from './system/elements.ts';
import { applyScale, solveOrientation, solvePosition, updateLagrange } from './system/solve.ts';

/**
 * What a Lagrange-point body is a point *of*.
 *
 * Carried on the SimBody the same way `sat` and `small` are: the point is not a
 * thing in its own right, it is a property of a pair, and everything the UI
 * wants to say about it comes from the pair rather than from the point.
 */
export interface LagrangeInfo {
  id: LagrangeId;
  /** The massive body at the centre — the Sun, for every point modelled here. */
  primary: SimBody;
  /** The body whose orbit the point rides. */
  secondary: SimBody;
  /** m2 / (m1 + m2). */
  massRatio: number;
  /** Position in the rotating frame, in units of the separation. */
  rotating: RotatingPoint;
  /** Hill radius of the secondary at its semi-major axis, km. */
  hillKm: number;
  /** True for L1/L2/L3 — the unstable ones. */
  collinear: boolean;
}

export interface SimBody {
  /** Unique, stable id. */
  key: string;
  name: string;
  type: BodyType;
  /** Search/label text including the parent, e.g. "Io — Jupiter I". */
  subtitle: string;

  parent: SimBody | null;
  children: SimBody[];
  depth: number;

  /** Equatorial radius, km. */
  radiusKm: number;
  flattening: number;

  spec: BodySpec | null;
  sat: SatelliteData | null;
  small: SmallBodyData | null;
  /** Set only on the massless marker bodies built by `addLagrangePoints`. */
  lagrange: LagrangeInfo | null;

  /** Orbital elements in `basis`, or null for the Sun. */
  elements: Elements | null;
  /** Reference frame of `elements`, expressed in ecliptic J2000. */
  basis: Basis;
  /** Sidereal orbital period, days. */
  periodDays: number;

  // ---- per-frame state -------------------------------------------------
  /** Heliocentric ecliptic J2000, km. */
  helioKm: Vec3;
  /** Relative to parent, km. Equals `helioKm` for planets. */
  localKm: Vec3;
  /** Velocity relative to parent, km/day. */
  velKm: Vec3;
  /** Position after scale remapping, scene units, absolute (Sun at origin). */
  scene: Vec3;
  /** Radius after scale remapping, scene units. */
  sceneRadius: number;
  /** Body-fixed frame in ecliptic J2000. */
  orientation: Basis;

  // ---- display ---------------------------------------------------------
  color: number;
  textureFile: string | null;
  note: string | null;
  /** Radius is a nominal guess rather than a measurement. */
  radiusEstimated: boolean;
  /** Fully simulated but drawn as a point sprite rather than a sphere. */
  minor: boolean;
}

export class SolarSystem {
  readonly bodies: SimBody[] = [];
  readonly byKey = new Map<string, SimBody>();
  readonly sun: SimBody;

  /**
   * Lagrange points, deliberately **not** in `bodies`.
   *
   * They are massless markers, not objects: they have no surface to collide
   * with, no orbit of their own to draw, no mesh, and no place in the point
   * cloud of minor bodies. Every loop over `bodies` — the promotion pool, the
   * free-flight clearance scan, the label candidates, the browser's catalogue
   * count — would have to special-case them if they were in there. Keeping them
   * in their own list means the default is to ignore them and the handful of
   * places that want them opt in. They are still in `byKey`, so a shared link or
   * `aphelion.goTo('lagrange:earth:L2')` resolves.
   */
  readonly lagrange: SimBody[] = [];
  /** Update order: parents before children. */
  private ordered: SimBody[] = [];

  /** Julian Date (TT) of the most recent update. */
  jdTT = 2451545.0;

  constructor() {
    this.sun = addSpec(this, SUN, null);

    for (const spec of PLANETS) {
      // Checked rather than cast: a planet added to the catalogue without a row
      // in the JPL table should fail loudly here, not propagate `undefined`
      // elements into every later update.
      if (!isPlanetKey(spec.key)) {
        throw new Error(`No planetary elements for '${spec.key}'`);
      }
      const body = addSpec(this, spec, this.sun);
      body.elements = planetOrbitElements(spec.key);
      body.periodDays = TWO_PI / Math.abs(body.elements.n);
    }

    // Dwarf planets take their orbits from the Minor Planet Center elements,
    // except Pluto which is in the JPL planetary table alongside the planets.
    const smallByName = new Map(SMALL_BODIES.map((b) => [b.name, b]));
    for (const spec of DWARF_PLANETS) {
      const body = addSpec(this, spec, this.sun);
      if (spec.key === 'pluto') {
        body.elements = planetOrbitElements('pluto');
        body.periodDays = TWO_PI / Math.abs(body.elements.n);
      } else {
        const match = smallByName.get(spec.name);
        if (match) {
          body.small = match;
          body.elements = elementsFromSmallBody(match);
          body.periodDays = TWO_PI / body.elements.n;
        }
      }
    }

    addSatellites(this);
    addMinorPlanets(this, this.sun, smallByName);
    addLagrangePoints(this, this.sun);

    // Depth-first ordering guarantees a parent is solved before its children.
    const walk = (b: SimBody): void => {
      this.ordered.push(b);
      for (const c of b.children) {
        walk(c);
      }
    };
    walk(this.sun);
  }

  // -- per-frame update ----------------------------------------------------

  /**
   * Recompute the whole system for an instant, then remap into scene space.
   */
  update(jdTT: number, scale: ScaleModel): void {
    this.jdTT = jdTT;
    const days = daysSinceJ2000(jdTT);
    const centuries = centuriesSinceJ2000(jdTT);

    for (const body of this.ordered) {
      solvePosition(body, this.sun, jdTT);
      solveOrientation(body, days, centuries);
    }
    for (const body of this.ordered) {
      applyScale(body, this.sun, scale);
    }
    // After the planets, and after the scale pass: a Lagrange point is built
    // from its planet's solved position and velocity, and remapped itself.
    updateLagrange(this.lagrange, scale);
  }

  // -- queries -------------------------------------------------------------

  /** Distance from the Sun's centre, km. */
  distanceToSun(body: SimBody): number {
    return length(body.helioKm);
  }

  /** Current orbital speed relative to the parent, km/s. */
  speedKmS(body: SimBody): number {
    return length(body.velKm) / 86_400;
  }

  /**
   * Orbit polyline for a body, in scene units, already scale-remapped.
   *
   * Sampled in eccentric anomaly and then pushed through the scale transform
   * point by point, because the transform is radial and non-linear: in explore
   * mode a true ellipse is no longer an ellipse on screen.
   *
   * **Points are relative to the parent's scene position**, so callers must
   * place the resulting geometry at `body.parent.scene`. For heliocentric bodies
   * that is the origin and the two are identical; for satellites it is what
   * keeps the vertices small enough to survive float32 (see the note inside).
   */
  orbitPolyline(body: SimBody, scale: ScaleModel, segments = 512): Float32Array | null {
    if (!body.elements || !body.parent) {
      return null;
    }

    const raw = sampleOrbit(body.elements, segments, this.jdTT);
    const out = new Float32Array((segments + 1) * 3);
    const parent = body.parent;
    const isHelio = parent === this.sun;

    const p: Vec3 = { x: 0, y: 0, z: 0 };
    for (let s = 0; s < segments; s++) {
      applyBasis(body.basis, raw[s * 3], raw[s * 3 + 1], raw[s * 3 + 2], p);
      const r = length(p);
      let f: number;
      if (isHelio) {
        f = r > 0 ? scale.heliocentricDistance(r) / r : 0;
      } else {
        // Deliberately parent-RELATIVE. Adding the parent's absolute scene
        // position here and storing the sum in a Float32Array destroys the
        // orbit: at Pluto's 1.28 million scene units the float32 spacing is
        // 0.085 units, while Charon's orbit is only 40 units across, so the
        // curve gets quantised into a visible sawtooth — 159x worse than the
        // error from tessellating it with 512 segments. The renderer positions
        // the line at the parent instead, keeping the shift in float64 until
        // after the floating-origin transform.
        f = r > 0 ? scale.satelliteDistance(r, parent.radiusKm) / r : 0;
      }
      out[s * 3] = p.x * f;
      out[s * 3 + 1] = p.y * f;
      out[s * 3 + 2] = p.z * f;
    }
    // Close the loop.
    out[segments * 3] = out[0]!;
    out[segments * 3 + 1] = out[1]!;
    out[segments * 3 + 2] = out[2]!;
    return out;
  }

  /** All bodies of a type, in catalogue order. */
  ofType(type: BodyType): SimBody[] {
    return this.bodies.filter((b) => b.type === type);
  }

  /** Moons of a body, largest first. */
  moonsOf(key: string): SimBody[] {
    const parent = this.byKey.get(key);
    if (!parent) {
      return [];
    }
    return parent.children
      .filter((c) => c.type === 'moon')
      .toSorted((a, b) => b.radiusKm - a.radiusKm);
  }

  /** The five Lagrange points of a planet, L1 through L5. Empty for anything else. */
  lagrangeOf(key: string): SimBody[] {
    return this.lagrange.filter((p) => p.lagrange!.secondary.key === key);
  }
}
