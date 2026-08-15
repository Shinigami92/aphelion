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
 */

import { AU_KM, DEG, GM, TWO_PI } from './constants.ts'
import type { ScaleModel } from './scale.ts'
import {
  applyBasis,
  basisForFrame,
  basisForPlanetEquator,
  IDENTITY_BASIS,
  spinBasis,
  tidallyLockedBasis,
  type Basis,
} from '../astro/frames.ts'
import {
  positionAtTime,
  sampleOrbit,
  velocityAtTime,
  type Elements,
  type Vec3,
} from '../astro/kepler.ts'
import {
  hillFraction,
  isCollinear,
  lagrangeGeometry,
  LAGRANGE_IDS,
  type LagrangeId,
  type RotatingPoint,
} from '../astro/lagrange.ts'
import { moonGeocentric, moonGeocentricVelocity } from '../astro/moon.ts'
import { PLANET_KEYS, planetOrbitElements, planetPosition, type PlanetKey } from '../astro/planets.ts'
import { centuriesSinceJ2000, daysSinceJ2000 } from '../astro/timescales.ts'
import {
  DWARF_PLANETS,
  MOON_NOTES,
  MOON_TEXTURES,
  MOON_TINTS,
  PLANETS,
  SMALL_BODY_RADII,
  SMALL_BODY_TEXTURES,
  SUN,
  type BodySpec,
  type BodyType,
} from '../data/bodies.ts'
import { SATELLITES, type SatelliteData } from '../data/generated/satellites.ts'
import { SMALL_BODIES, type SmallBodyData } from '../data/generated/smallbodies.ts'

/**
 * What a Lagrange-point body is a point *of*.
 *
 * Carried on the SimBody the same way `sat` and `small` are: the point is not a
 * thing in its own right, it is a property of a pair, and everything the UI
 * wants to say about it comes from the pair rather than from the point.
 */
export interface LagrangeInfo {
  id: LagrangeId
  /** The massive body at the centre — the Sun, for every point modelled here. */
  primary: SimBody
  /** The body whose orbit the point rides. */
  secondary: SimBody
  /** m2 / (m1 + m2). */
  massRatio: number
  /** Position in the rotating frame, in units of the separation. */
  rotating: RotatingPoint
  /** Hill radius of the secondary at its semi-major axis, km. */
  hillKm: number
  /** True for L1/L2/L3 — the unstable ones. */
  collinear: boolean
}

export interface SimBody {
  /** Unique, stable id. */
  key: string
  name: string
  type: BodyType
  /** Search/label text including the parent, e.g. "Io — Jupiter I". */
  subtitle: string

  parent: SimBody | null
  children: SimBody[]
  depth: number

  /** Equatorial radius, km. */
  radiusKm: number
  flattening: number

  spec: BodySpec | null
  sat: SatelliteData | null
  small: SmallBodyData | null
  /** Set only on the massless marker bodies built by `addLagrangePoints`. */
  lagrange: LagrangeInfo | null

  /** Orbital elements in `basis`, or null for the Sun. */
  elements: Elements | null
  /** Reference frame of `elements`, expressed in ecliptic J2000. */
  basis: Basis
  /** Sidereal orbital period, days. */
  periodDays: number

  // ---- per-frame state -------------------------------------------------
  /** Heliocentric ecliptic J2000, km. */
  helioKm: Vec3
  /** Relative to parent, km. Equals `helioKm` for planets. */
  localKm: Vec3
  /** Velocity relative to parent, km/day. */
  velKm: Vec3
  /** Position after scale remapping, scene units, absolute (Sun at origin). */
  scene: Vec3
  /** Radius after scale remapping, scene units. */
  sceneRadius: number
  /** Body-fixed frame in ecliptic J2000. */
  orientation: Basis

  // ---- display ---------------------------------------------------------
  color: number
  textureFile: string | null
  note: string | null
  /** Radius is a nominal guess rather than a measurement. */
  radiusEstimated: boolean
  /** Fully simulated but drawn as a point sprite rather than a sphere. */
  minor: boolean
}

const tmpA: Vec3 = { x: 0, y: 0, z: 0 }
const tmpB: Vec3 = { x: 0, y: 0, z: 0 }

/** Diameter from absolute magnitude and albedo — the standard relation. */
function diameterFromMagnitude(h: number, albedo: number): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -0.2 * h)
}

/** Typical albedo per dynamical family. */
const GROUP_ALBEDO: Record<string, number> = {
  'near-earth': 0.15,
  'inner-belt': 0.15,
  'mid-belt': 0.09,
  'outer-belt': 0.06,
  cybele: 0.05,
  hilda: 0.05,
  'jupiter-trojan': 0.05,
  centaur: 0.08,
  plutino: 0.11,
  'classical-kbo': 0.12,
  scattered: 0.09,
  detached: 0.12,
}

const GROUP_COLOR: Record<string, number> = {
  'near-earth': 0xa89880,
  'inner-belt': 0xa89880,
  'mid-belt': 0x9a8e78,
  'outer-belt': 0x8a7d68,
  cybele: 0x8a7058,
  hilda: 0x9a7758,
  'jupiter-trojan': 0x8a6f58,
  centaur: 0x9a8478,
  plutino: 0xa08c90,
  'classical-kbo': 0x93a0b0,
  scattered: 0x8695a5,
  detached: 0x93a2b8,
}

const GROUP_LABEL: Record<string, string> = {
  'near-earth': 'near-Earth asteroid',
  'inner-belt': 'inner main belt',
  'mid-belt': 'middle main belt',
  'outer-belt': 'outer main belt',
  cybele: 'Cybele group',
  hilda: 'Hilda group',
  'jupiter-trojan': 'Jupiter Trojan',
  centaur: 'Centaur',
  plutino: 'plutino (3:2 with Neptune)',
  'classical-kbo': 'classical Kuiper belt',
  scattered: 'scattered disc',
  detached: 'detached object',
}

/** Roman numeral designations, for satellite subtitles. */
const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
]

function romanFor(code: number): string {
  // NAIF satellite codes are <planet><index>, e.g. 501 = Jupiter I.
  const index = code % 100
  return index > 0 && index < ROMAN.length ? ROMAN[index]! : String(index)
}

/**
 * What is actually parked at, or trapped in, each point.
 *
 * Keyed `<planet>:<id>`. Only the entries with something real to say are
 * listed; the rest fall back to the generic description the info panel builds
 * from the geometry.
 */
const LAGRANGE_NOTES: Record<string, string> = {
  'earth:L1': 'SOHO and DSCOVR hold halo orbits here, on the sunward side, where the Sun is never eclipsed and the solar wind arrives 15 to 60 minutes before it reaches Earth.',
  'earth:L2': 'The James Webb Space Telescope, Gaia and Euclid orbit here. Earth, Moon and Sun stay in the same half of the sky, so one shield covers all three and the far side is permanently cold and dark.',
  'earth:L3': 'Permanently hidden behind the Sun from Earth, which made it a favourite home for a fictional "Counter-Earth". Nothing is there: perturbations from Venus alone would clear the point in about 150 years.',
  'earth:L4': 'Holds 2010 TK7, the first Earth Trojan found, and 2020 XL5. Both librate in wide, tilted arcs rather than sitting at the point.',
  'earth:L5': 'No Earth Trojan has ever been confirmed here — Hayabusa2 photographed the point on its way out in 2017 and found nothing. Both known Earth Trojans are at L4. (The Kordylewski dust clouds are a different pair of points, of the Earth–Moon system, which Aphelion does not model.)',
  'mars:L4': 'Home to a small, stable Trojan family — 1999 UJ7 is the only one at L4, against several at L5.',
  'mars:L5': 'Holds 5261 Eureka and its relatives, a genuine collisional family that has probably been here since Mars formed.',
  'jupiter:L4': 'The Greek camp: tens of thousands of catalogued Trojans, led by 588 Achilles. Aphelion draws about 4,200 of them as part of the belt swarm.',
  'jupiter:L5': 'The Trojan camp, led by 617 Patroclus. Slightly less populous than the Greeks, for reasons still argued over.',
  'neptune:L4': 'The largest known Trojan population after Jupiter’s, and probably larger still — they are simply very faint at 30 AU.',
  'neptune:L5': 'Holds several known Trojans, including 2008 LC18, found in a deliberate search through a gap in the Galactic plane.',
}

/**
 * Nominal size of a Lagrange-point marker, as a fraction of the Hill radius.
 *
 * A Lagrange point has no size, but the camera frames what it focuses in radii
 * of it, so it needs a viewing scale — and that scale has to grow with the
 * system, or Neptune's points would be framed like Mercury's. A twentieth of
 * the Hill radius puts the default 4.2-radii arrival at about a fifth of the
 * way to the planet, close enough to read the marker with the planet still a
 * visible disc behind it. It also sets how close you may zoom: 1.02 of it.
 */
const MARKER_HILL_FRACTION = 20

export class SolarSystem {
  readonly bodies: SimBody[] = []
  readonly byKey = new Map<string, SimBody>()
  readonly sun: SimBody

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
  readonly lagrange: SimBody[] = []
  /** Update order: parents before children. */
  private ordered: SimBody[] = []

  /** Julian Date (TT) of the most recent update. */
  jdTT = 2451545.0

  constructor() {
    this.sun = this.addSpec(SUN, null)

    for (const spec of PLANETS) {
      const body = this.addSpec(spec, this.sun)
      body.elements = planetOrbitElements(spec.key as PlanetKey)
      body.periodDays = TWO_PI / Math.abs(body.elements.n)
    }

    // Dwarf planets take their orbits from the Minor Planet Center elements,
    // except Pluto which is in the JPL planetary table alongside the planets.
    const smallByName = new Map(SMALL_BODIES.map((b) => [b.name, b]))
    for (const spec of DWARF_PLANETS) {
      const body = this.addSpec(spec, this.sun)
      if (spec.key === 'pluto') {
        body.elements = planetOrbitElements('pluto')
        body.periodDays = TWO_PI / Math.abs(body.elements.n)
      } else {
        const match = smallByName.get(spec.name)
        if (match) {
          body.small = match
          body.elements = elementsFromSmallBody(match)
          body.periodDays = TWO_PI / body.elements.n
        }
      }
    }

    this.addSatellites()
    this.addMinorPlanets(smallByName)
    this.addLagrangePoints()

    // Depth-first ordering guarantees a parent is solved before its children.
    const walk = (b: SimBody): void => {
      this.ordered.push(b)
      for (const c of b.children) walk(c)
    }
    walk(this.sun)
  }

  // -- construction --------------------------------------------------------

  private addSpec(spec: BodySpec, parent: SimBody | null): SimBody {
    const body = makeBody({
      key: spec.key,
      name: spec.name,
      type: spec.type,
      subtitle:
        spec.type === 'star' ? 'G2V main-sequence star' : spec.type === 'dwarf' ? 'dwarf planet' : 'planet',
      parent,
      radiusKm: spec.radiusKm,
      flattening: spec.flattening,
      spec,
      color: spec.color,
      textureFile: spec.textures?.map ?? null,
      note: null,
      minor: false,
    })
    this.register(body, parent)
    return body
  }

  private addSatellites(): void {
    for (const sat of SATELLITES) {
      const parent = this.byKey.get(sat.planet)
      if (!parent) continue

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
          : basisForFrame(sat.frame, sat.poleRa, sat.poleDec)
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
      })
      body.sat = sat
      body.basis = basis
      body.radiusEstimated = sat.radiusEstimated
      body.elements = elementsFromSatellite(sat)
      body.periodDays = sat.period
      this.register(body, parent)
    }
  }

  private addMinorPlanets(smallByName: Map<string, SmallBodyData>): void {
    const dwarfNames = new Set(DWARF_PLANETS.map((d) => d.name))
    for (const sb of SMALL_BODIES) {
      // Dwarf planets already exist as fully specified bodies.
      if (dwarfNames.has(sb.name)) continue
      // Charon and friends are satellites, not heliocentric minor planets.
      if (this.byKey.has(`moon:${sb.name}`)) continue
      void smallByName

      const albedo = GROUP_ALBEDO[sb.group] ?? 0.1
      const measured = SMALL_BODY_RADII[sb.name]
      const radius = measured ?? diameterFromMagnitude(sb.h, albedo) / 2
      const body = makeBody({
        key: `sb:${sb.name}`,
        name: sb.name,
        type: 'asteroid',
        subtitle: GROUP_LABEL[sb.group] ?? sb.group,
        parent: this.sun,
        radiusKm: radius,
        flattening: 0,
        spec: null,
        color: GROUP_COLOR[sb.group] ?? 0x9a8e78,
        textureFile: SMALL_BODY_TEXTURES[sb.name] ?? null,
        note: null,
        minor: true,
      })
      body.small = sb
      body.radiusEstimated = measured === undefined
      body.elements = elementsFromSmallBody(sb)
      body.periodDays = TWO_PI / body.elements.n
      this.register(body, this.sun)
    }
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
  private addLagrangePoints(): void {
    for (const planet of this.sun.children) {
      if (planet.type !== 'planet' || !planet.spec || !planet.elements) continue
      const gm = GM[planet.spec.key as keyof typeof GM]
      if (!gm) continue

      // The planet's own GM, not the planet-plus-moons figure. It is the
      // geocentre that Aphelion draws and that the marker is placed against, so
      // this keeps the mass and the geometry describing the same body. For
      // Earth — the only case where it is even arguable — folding the Moon in
      // would move L1 and L2 outward by 0.4%, or 6,000 km in 1.5 million.
      const massRatio = gm / (GM.sun + gm)
      const geometry = lagrangeGeometry(massRatio)
      const hillKm = planet.elements.a * hillFraction(massRatio)

      for (const id of LAGRANGE_IDS) {
        const collinear = isCollinear(id)
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
        })
        body.lagrange = {
          id,
          primary: this.sun,
          secondary: planet,
          massRatio,
          rotating: geometry[id],
          hillKm,
          collinear,
        }
        // A 1:1 co-orbital: it goes round the Sun exactly as often as its planet.
        body.periodDays = planet.periodDays
        body.depth = planet.depth + 1
        this.lagrange.push(body)
        this.byKey.set(body.key, body)
      }
    }
  }

  private register(body: SimBody, parent: SimBody | null): void {
    this.bodies.push(body)
    this.byKey.set(body.key, body)
    if (parent) {
      parent.children.push(body)
      body.depth = parent.depth + 1
    }
  }

  // -- per-frame update ----------------------------------------------------

  /**
   * Recompute the whole system for an instant, then remap into scene space.
   */
  update(jdTT: number, scale: ScaleModel): void {
    this.jdTT = jdTT
    const days = daysSinceJ2000(jdTT)
    const centuries = centuriesSinceJ2000(jdTT)

    for (const body of this.ordered) {
      this.solvePosition(body, jdTT)
      this.solveOrientation(body, days, centuries)
    }
    for (const body of this.ordered) this.applyScale(body, scale)
    // After the planets, and after the scale pass: a Lagrange point is built
    // from its planet's solved position and velocity, and remapped itself.
    this.updateLagrange(scale)
  }

  /**
   * Place every Lagrange point for the instant just solved.
   *
   * The rotating frame is rebuilt from the pair's real geometry each time
   * rather than assumed: the separation `R` is the *instantaneous* one, so the
   * whole configuration breathes in and out with the planet's eccentricity, and
   * the orbit normal comes from r x v, so the points track the plane rather
   * than sitting in a nominal ecliptic. That makes these the points of the
   * circular problem evaluated at the current separation — which is what
   * everyone means by "Sun-Earth L2", and what its 1.5 million km refers to.
   *
   * Note the frame is right-handed by construction: `w` is the orbit normal
   * crossed into the radial direction, which for any orbit is the direction of
   * travel. That is what makes L4 *lead* the planet by 60 degrees and L5 trail
   * it, rather than the other way round — and getting it backwards would put
   * Jupiter's L4 marker in the middle of the Trojan camp instead of the Greek
   * one, with nothing else on screen looking any different.
   */
  private updateLagrange(scale: ScaleModel): void {
    for (const point of this.lagrange) {
      const info = point.lagrange!
      const primary = info.primary
      const secondary = info.secondary

      const rx = secondary.helioKm.x - primary.helioKm.x
      const ry = secondary.helioKm.y - primary.helioKm.y
      const rz = secondary.helioKm.z - primary.helioKm.z
      const R = Math.hypot(rx, ry, rz)
      if (R < 1) continue

      const ux = rx / R
      const uy = ry / R
      const uz = rz / R

      const vx = secondary.velKm.x - primary.velKm.x
      const vy = secondary.velKm.y - primary.velKm.y
      const vz = secondary.velKm.z - primary.velKm.z
      const hx = ry * vz - rz * vy
      const hy = rz * vx - rx * vz
      const hz = rx * vy - ry * vx
      const h = Math.hypot(hx, hy, hz)
      if (h < 1e-9) continue
      const nx = hx / h
      const ny = hy / h
      const nz = hz / h

      // In-plane, perpendicular to the radius, along the direction of travel.
      const wx = ny * uz - nz * uy
      const wy = nz * ux - nx * uz
      const wz = nx * uy - ny * ux

      // The nondimensional frame has its origin at the barycentre, which for a
      // Sun-planet pair sits just inside the Sun — but not at its centre, and
      // the offset is exactly what puts L3 slightly beyond one orbit radius.
      const bx = primary.helioKm.x + info.massRatio * rx
      const by = primary.helioKm.y + info.massRatio * ry
      const bz = primary.helioKm.z + info.massRatio * rz

      const g = info.rotating
      point.helioKm.x = bx + R * (g.x * ux + g.y * wx)
      point.helioKm.y = by + R * (g.x * uy + g.y * wy)
      point.helioKm.z = bz + R * (g.x * uz + g.y * wz)

      point.localKm.x = point.helioKm.x - secondary.helioKm.x
      point.localKm.y = point.helioKm.y - secondary.helioKm.y
      point.localKm.z = point.helioKm.z - secondary.helioKm.z

      // Remapped as the heliocentric body it is, not as a satellite of its
      // planet: L4 and L5 are a full orbit radius from the planet, and L3 is
      // two. Going through the satellite law would compress them into the
      // planet's lap. This also keeps L4 and L5 exactly on the planet's own
      // drawn orbit, since the remap is radial and they share its radius.
      const r = length(point.helioKm)
      const f = r > 0 ? scale.heliocentricDistance(r) / r : 0
      point.scene.x = point.helioKm.x * f
      point.scene.y = point.helioKm.y * f
      point.scene.z = point.helioKm.z * f
      point.sceneRadius = scale.bodyRadius(point.radiusKm)
    }
  }

  private solvePosition(body: SimBody, jdTT: number): void {
    if (body === this.sun) {
      zero(body.helioKm)
      zero(body.localKm)
      zero(body.velKm)
      return
    }

    // Planets (and Pluto) come from the JPL Keplerian theory.
    if (body.spec && isPlanetKey(body.spec.key)) {
      planetPosition(body.spec.key, jdTT, body.helioKm)
      copy(body.localKm, body.helioKm)
      // Finite-difference velocity, good enough for orientation and readouts.
      planetPosition(body.spec.key, jdTT + 0.5, tmpA)
      planetPosition(body.spec.key, jdTT - 0.5, tmpB)
      body.velKm.x = tmpA.x - tmpB.x
      body.velKm.y = tmpA.y - tmpB.y
      body.velKm.z = tmpA.z - tmpB.z
      return
    }

    // Earth's Moon gets the full lunar theory rather than mean elements.
    if (body.key === 'moon:Moon') {
      moonGeocentric(jdTT, body.localKm)
      moonGeocentricVelocity(jdTT, body.velKm)
      addTo(body.helioKm, body.parent!.helioKm, body.localKm)
      return
    }

    if (!body.elements) {
      zero(body.helioKm)
      zero(body.localKm)
      return
    }

    // Everything else: mean elements in their own reference plane.
    positionAtTime(body.elements, jdTT, tmpA)
    applyBasis(body.basis, tmpA.x, tmpA.y, tmpA.z, body.localKm)

    velocityAtTime(body.elements, jdTT, tmpB)
    applyBasis(body.basis, tmpB.x, tmpB.y, tmpB.z, body.velKm)

    if (body.parent && body.parent !== this.sun) {
      addTo(body.helioKm, body.parent.helioKm, body.localKm)
    } else {
      copy(body.helioKm, body.localKm)
    }
  }

  private solveOrientation(body: SimBody, days: number, centuries: number): void {
    if (body.spec) {
      body.orientation = spinBasis(body.spec.spin, days, centuries)
      return
    }
    if (body.type === 'moon') {
      // Tidal locking derived from the geometry; correct for essentially every
      // satellite large enough for anyone to notice, and free of extra data. The
      // parent's pole only disambiguates north from south, and it is available
      // here because `ordered` is depth-first, so the parent is already solved.
      body.orientation = tidallyLockedBasis(
        body.localKm,
        body.velKm,
        body.parent?.spec ? body.parent.orientation.z : null,
      )
      return
    }
    // Minor planets: no measured pole for most, so spin about the ecliptic pole
    // at a plausible rate seeded by the body's own elements.
    const rate = 40 + ((body.small?.h ?? 10) % 7) * 130
    body.orientation = spinBasis({ poleRa: 0, poleDec: 90, w0: 0, wDot: rate }, days, centuries)
  }

  private applyScale(body: SimBody, scale: ScaleModel): void {
    body.sceneRadius = scale.bodyRadius(body.radiusKm)

    if (body === this.sun) {
      zero(body.scene)
      return
    }

    const parent = body.parent!
    if (parent === this.sun) {
      const r = length(body.helioKm)
      const f = r > 0 ? scale.heliocentricDistance(r) / r : 0
      body.scene.x = body.helioKm.x * f
      body.scene.y = body.helioKm.y * f
      body.scene.z = body.helioKm.z * f
      return
    }

    const rLocal = length(body.localKm)
    const f = rLocal > 0 ? scale.satelliteDistance(rLocal, parent.radiusKm) / rLocal : 0
    body.scene.x = parent.scene.x + body.localKm.x * f
    body.scene.y = parent.scene.y + body.localKm.y * f
    body.scene.z = parent.scene.z + body.localKm.z * f
  }

  // -- queries -------------------------------------------------------------

  /** Distance from the Sun's centre, km. */
  distanceToSun(body: SimBody): number {
    return length(body.helioKm)
  }

  /** Current orbital speed relative to the parent, km/s. */
  speedKmS(body: SimBody): number {
    return length(body.velKm) / 86_400
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
    if (!body.elements || !body.parent) return null

    const raw = sampleOrbit(body.elements, segments, this.jdTT)
    const out = new Float32Array((segments + 1) * 3)
    const parent = body.parent
    const isHelio = parent === this.sun

    const p: Vec3 = { x: 0, y: 0, z: 0 }
    for (let s = 0; s < segments; s++) {
      applyBasis(body.basis, raw[s * 3]!, raw[s * 3 + 1]!, raw[s * 3 + 2]!, p)
      let x: number
      let y: number
      let z: number
      if (isHelio) {
        const r = length(p)
        const f = r > 0 ? scale.heliocentricDistance(r) / r : 0
        x = p.x * f
        y = p.y * f
        z = p.z * f
      } else {
        // Deliberately parent-RELATIVE. Adding the parent's absolute scene
        // position here and storing the sum in a Float32Array destroys the
        // orbit: at Pluto's 1.28 million scene units the float32 spacing is
        // 0.085 units, while Charon's orbit is only 40 units across, so the
        // curve gets quantised into a visible sawtooth — 159x worse than the
        // error from tessellating it with 512 segments. The renderer positions
        // the line at the parent instead, keeping the shift in float64 until
        // after the floating-origin transform.
        const r = length(p)
        const f = r > 0 ? scale.satelliteDistance(r, parent.radiusKm) / r : 0
        x = p.x * f
        y = p.y * f
        z = p.z * f
      }
      out[s * 3] = x
      out[s * 3 + 1] = y
      out[s * 3 + 2] = z
    }
    // Close the loop.
    out[segments * 3] = out[0]!
    out[segments * 3 + 1] = out[1]!
    out[segments * 3 + 2] = out[2]!
    return out
  }

  /** All bodies of a type, in catalogue order. */
  ofType(type: BodyType): SimBody[] {
    return this.bodies.filter((b) => b.type === type)
  }

  /** Moons of a body, largest first. */
  moonsOf(key: string): SimBody[] {
    const parent = this.byKey.get(key)
    if (!parent) return []
    return parent.children.filter((c) => c.type === 'moon').sort((a, b) => b.radiusKm - a.radiusKm)
  }

  /** The five Lagrange points of a planet, L1 through L5. Empty for anything else. */
  lagrangeOf(key: string): SimBody[] {
    return this.lagrange.filter((p) => p.lagrange!.secondary.key === key)
  }
}

// ---------------------------------------------------------------------------
// Element conversion
// ---------------------------------------------------------------------------

function elementsFromSatellite(sat: SatelliteData): Elements {
  const retrograde = sat.inc > 90
  // JPL quotes the apsidal and nodal precession as periods in years. Prograde
  // satellites of an oblate primary have an advancing apsis and a regressing
  // node; retrograde satellites are the other way round.
  const apsisRate =
    sat.apsisPeriod && sat.apsisPeriod !== 0 ? TWO_PI / (sat.apsisPeriod * 365.25) : 0
  const nodeRate = sat.nodePeriod && sat.nodePeriod !== 0 ? TWO_PI / (sat.nodePeriod * 365.25) : 0

  return {
    a: sat.a,
    e: sat.e,
    i: sat.inc * DEG,
    node: sat.node * DEG,
    argPeri: sat.argPeri * DEG,
    m0: sat.m0 * DEG,
    epoch: sat.epoch,
    n: TWO_PI / sat.period,
    argPeriDot: retrograde ? -apsisRate : apsisRate,
    nodeDot: retrograde ? nodeRate : -nodeRate,
  }
}

/** Gaussian gravitational constant: n = k / a^1.5 rad/day, a in AU. */
const GAUSS_K = 0.01720209895

function elementsFromSmallBody(sb: SmallBodyData): Elements {
  return {
    a: sb.a * AU_KM,
    e: sb.e,
    i: sb.inc * DEG,
    node: sb.node * DEG,
    argPeri: sb.argPeri * DEG,
    m0: sb.m0 * DEG,
    epoch: sb.epoch,
    n: GAUSS_K / Math.pow(sb.a, 1.5),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BodyInit {
  key: string
  name: string
  type: BodyType
  subtitle: string
  parent: SimBody | null
  radiusKm: number
  flattening: number
  spec: BodySpec | null
  color: number
  textureFile: string | null
  note: string | null
  minor: boolean
}

function makeBody(init: BodyInit): SimBody {
  return {
    key: init.key,
    name: init.name,
    type: init.type,
    subtitle: init.subtitle,
    parent: init.parent,
    children: [],
    depth: 0,
    radiusKm: init.radiusKm,
    flattening: init.flattening,
    spec: init.spec,
    sat: null,
    small: null,
    lagrange: null,
    elements: null,
    basis: IDENTITY_BASIS,
    periodDays: 0,
    helioKm: { x: 0, y: 0, z: 0 },
    localKm: { x: 0, y: 0, z: 0 },
    velKm: { x: 0, y: 0, z: 0 },
    scene: { x: 0, y: 0, z: 0 },
    sceneRadius: 0,
    orientation: IDENTITY_BASIS,
    color: init.color,
    textureFile: init.textureFile,
    note: init.note,
    radiusEstimated: false,
    minor: init.minor,
  }
}

const isPlanetKey = (key: string): key is PlanetKey =>
  (PLANET_KEYS as readonly string[]).includes(key)

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const zero = (v: Vec3): void => {
  v.x = 0
  v.y = 0
  v.z = 0
}
const copy = (dst: Vec3, src: Vec3): void => {
  dst.x = src.x
  dst.y = src.y
  dst.z = src.z
}
const addTo = (dst: Vec3, a: Vec3, b: Vec3): void => {
  dst.x = a.x + b.x
  dst.y = a.y + b.y
  dst.z = a.z + b.z
}
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

/** Exported for the info panel: escape velocity from GM and radius. */
export function escapeVelocity(gmKm3S2: number, radiusKm: number): number {
  return Math.sqrt((2 * gmKm3S2) / radiusKm)
}

/** Hill sphere radius, km — the practical edge of a planet's gravitational reach. */
export function hillRadius(body: SimBody): number | null {
  if (!body.spec || !isPlanetKey(body.spec.key)) return null
  const gmPlanet = GM[body.spec.key as keyof typeof GM]
  if (!gmPlanet) return null
  const a = length(body.helioKm)
  return a * Math.cbrt(gmPlanet / (3 * GM.sun))
}
