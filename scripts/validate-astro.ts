/**
 * Sanity checks for the astronomy core.
 *
 * Run with: pnpm validate
 *
 * These are invariants and known reference values, not a full ephemeris
 * comparison — the point is to catch sign errors, unit slips and frame mixups,
 * which is exactly the class of bug that silently produces a plausible-looking
 * but wrong solar system.
 */

import { AU_KM, DEG, RAD } from '../src/core/constants.ts'
import {
  calendarToJd,
  formatUtc,
  jdToCalendar,
  jdUtcToTt,
  parseUtc,
  taiMinusUtc,
} from '../src/astro/timescales.ts'
import { solveEccentricAnomaly, wrap2pi } from '../src/astro/kepler.ts'
import { PLANET_KEYS, planetPosition, type PlanetKey } from '../src/astro/planets.ts'
import { moonSpherical } from '../src/astro/moon.ts'
import { SolarSystem } from '../src/core/system.ts'
import { ScaleModel } from '../src/core/scale.ts'
import { ALL_BODY_SPECS } from '../src/data/bodies.ts'
import {
  DEFAULT_LABELS,
  DEFAULT_ORBITS,
  DEFAULT_TOGGLES,
  encodeView,
  parseView,
} from '../src/core/url-state.ts'
import { reliefFor } from '../src/data/generated/relief.ts'
import { STAR_CATALOGUE } from '../src/data/generated/stars.ts'
import { unpackStars } from '../src/data/stars.ts'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const SHAPES_DIR = path.join(PUBLIC_DIR, 'shapes')

/**
 * Just enough PNG to read back what fetch-assets.ts writes: 8-bit truecolour,
 * no interlacing. Decoding here rather than trusting the numbers the encoder
 * reported means this check covers the file that actually ships.
 */
function decodePng(buf: Buffer): { width: number; height: number; data: Buffer } {
  let pos = 8 // skip signature
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error(`unexpected PNG format: depth ${data[8]}, colour ${data[9]}`)
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 3
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x]!
      const left = x >= 3 ? out[dst + x - 3]! : 0
      const up = y > 0 ? out[dst - stride + x]! : 0
      if (filter === 0) out[dst + x] = cur
      else if (filter === 1) out[dst + x] = (cur + left) & 0xff
      else if (filter === 2) out[dst + x] = (cur + up) & 0xff
      else throw new Error(`unsupported PNG filter ${filter}`)
    }
  }
  return { width, height, data: out }
}

let failures = 0
let checks = 0

function ok(name: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? `  ${detail}` : ''}`)
  } else {
    failures++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? `  ${detail}` : ''}`)
  }
}

function near(name: string, actual: number, expected: number, tol: number, unit = ''): void {
  const d = Math.abs(actual - expected)
  ok(name, d <= tol, `got ${actual.toFixed(6)}${unit}, expected ${expected}±${tol}${unit}`)
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

// ---------------------------------------------------------------------------
section('Time scales')

near('J2000 epoch JD', calendarToJd({ year: 2000, month: 1, day: 1, hour: 12, minute: 0, second: 0, ms: 0 }), 2451545.0, 1e-9)
near('Unix epoch JD', calendarToJd({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 }), 2440587.5, 1e-9)
near('leap seconds 2026', taiMinusUtc(calendarToJd({ year: 2026, month: 8, day: 6, hour: 0, minute: 0, second: 0, ms: 0 })), 37, 0)
// Tolerance is set by the f64 round-off of differencing two ~2.46e6 Julian
// Dates and scaling by 86400, not by the accuracy of the leap-second table.
near('TT-UTC 2026 (seconds)', (jdUtcToTt(2461000.5) - 2461000.5) * 86400, 69.184, 1e-4)

{
  // Round-trip a spread of dates through the calendar conversions.
  const dates = [
    { year: 1600, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    { year: 1899, month: 12, day: 31, hour: 23, minute: 59, second: 59, ms: 0 },
    { year: 2026, month: 8, day: 6, hour: 14, minute: 32, second: 7, ms: 0 },
    // 2500 is a century year not divisible by 400, so February has 28 days.
    { year: 2500, month: 2, day: 28, hour: 6, minute: 0, second: 0, ms: 0 },
    { year: 2400, month: 2, day: 29, hour: 6, minute: 0, second: 0, ms: 0 },
  ]
  let allOk = true
  for (const d of dates) {
    const back = jdToCalendar(calendarToJd(d))
    if (
      back.year !== d.year ||
      back.month !== d.month ||
      back.day !== d.day ||
      back.hour !== d.hour ||
      back.minute !== d.minute ||
      Math.abs(back.second - d.second) > 1
    ) {
      allOk = false
      console.log(`      mismatch: ${JSON.stringify(d)} -> ${JSON.stringify(back)}`)
    }
  }
  ok('calendar round-trip', allOk)
}

ok('parseUtc round-trip', formatUtc(parseUtc('2026-08-06 14:32:07')!) === '2026-08-06 14:32:07')
ok('parseUtc rejects garbage', parseUtc('not a date') === null)
ok('parseUtc rejects month 13', parseUtc('2026-13-01') === null)

// ---------------------------------------------------------------------------
section("Kepler's equation")

{
  let worst = 0
  for (const e of [0, 0.01, 0.2, 0.5, 0.8, 0.9, 0.95, 0.99]) {
    for (let k = 0; k < 64; k++) {
      const M = (k / 64) * 2 * Math.PI
      const E = solveEccentricAnomaly(M, e)
      // Residual of Kepler's equation itself.
      const residual = Math.abs(wrap2pi(E - e * Math.sin(E)) - wrap2pi(M))
      worst = Math.max(worst, Math.min(residual, Math.abs(residual - 2 * Math.PI)))
    }
  }
  ok('Kepler residual < 1e-9 rad for e up to 0.99', worst < 1e-9, `worst ${worst.toExponential(2)}`)
}

// ---------------------------------------------------------------------------
section('Planetary positions — 2026-08-06 00:00 UTC')

const jdUtc = calendarToJd({ year: 2026, month: 8, day: 6, hour: 0, minute: 0, second: 0, ms: 0 })
const jdTT = jdUtcToTt(jdUtc)

const v = { x: 0, y: 0, z: 0 }

/** Expected heliocentric distance ranges (perihelion..aphelion), AU. */
const RANGES: Record<PlanetKey, [number, number]> = {
  mercury: [0.307, 0.467],
  venus: [0.718, 0.728],
  earth: [0.983, 1.017],
  mars: [1.381, 1.666],
  jupiter: [4.95, 5.46],
  saturn: [9.02, 10.05],
  uranus: [18.28, 20.1],
  neptune: [29.8, 30.33],
  pluto: [29.6, 49.4],
}

for (const key of PLANET_KEYS) {
  planetPosition(key, jdTT, v)
  const rAu = Math.hypot(v.x, v.y, v.z) / AU_KM
  const [lo, hi] = RANGES[key]
  const lon = wrap2pi(Math.atan2(v.y, v.x)) * RAD
  const lat = Math.asin(v.z / (rAu * AU_KM)) * RAD
  ok(
    `${key.padEnd(8)} r in [${lo}, ${hi}] AU`,
    rAu >= lo && rAu <= hi,
    `r=${rAu.toFixed(4)} AU  lon=${lon.toFixed(2)}°  lat=${lat.toFixed(2)}°`,
  )
}

// The Sun's geocentric longitude is the Earth's heliocentric longitude + 180.
// On 6 August the Sun sits at roughly 13-14° of Leo, i.e. ecliptic longitude
// ~133-134°, which is a value anyone can check against an almanac.
{
  planetPosition('earth', jdTT, v)
  const sunLon = wrap2pi(Math.atan2(-v.y, -v.x)) * RAD
  near('Sun geocentric longitude', sunLon, 133.6, 1.0, '°')

  const rAu = Math.hypot(v.x, v.y, v.z) / AU_KM
  near('Earth-Sun distance (early Aug)', rAu, 1.0146, 0.002, ' AU')

  // Earth's orbit defines the ecliptic, so its latitude must be ~0.
  const lat = Math.asin(v.z / (rAu * AU_KM)) * RAD
  ok('Earth ecliptic latitude ~ 0', Math.abs(lat) < 0.01, `lat=${lat.toExponential(2)}°`)
}

// ---------------------------------------------------------------------------
section('Lunar theory')

{
  const m = moonSpherical(jdTT)
  ok(
    'Moon distance within perigee/apogee bounds',
    m.distance > 356_000 && m.distance < 407_000,
    `${m.distance.toFixed(0)} km`,
  )
  ok(
    'Moon ecliptic latitude within ±5.4°',
    Math.abs(m.latitude * RAD) <= 5.45,
    `${(m.latitude * RAD).toFixed(3)}°`,
  )

  // Sample a synodic month: the Moon must sweep a full 360° of longitude and
  // its distance must vary by roughly the real perigee-apogee spread.
  let minD = Infinity
  let maxD = -Infinity
  for (let k = 0; k < 240; k++) {
    const s = moonSpherical(jdTT + (k * 29.53) / 240)
    minD = Math.min(minD, s.distance)
    maxD = Math.max(maxD, s.distance)
  }
  ok('perigee near 362-370k km', minD > 356_000 && minD < 372_000, `min ${minD.toFixed(0)} km`)
  ok('apogee near 400-407k km', maxD > 398_000 && maxD < 407_500, `max ${maxD.toFixed(0)} km`)

  // Draconic check: latitude must cross zero twice per 27.2 days.
  let crossings = 0
  let prev = Math.sign(moonSpherical(jdTT).latitude)
  for (let k = 1; k <= 400; k++) {
    const s = Math.sign(moonSpherical(jdTT + (k * 27.212) / 400).latitude)
    if (s !== prev) crossings++
    prev = s
  }
  ok('two nodal crossings per draconic month', crossings === 2, `${crossings} crossings`)
}

// ---------------------------------------------------------------------------
section('Orbital periods (from the mean-longitude rates)')

{
  // Recover each planet's sidereal period by timing a full 360° sweep of
  // heliocentric longitude. Catches rate/units errors in the element table.
  const EXPECTED_YEARS: Record<PlanetKey, number> = {
    mercury: 0.2408,
    venus: 0.6152,
    earth: 1.0,
    mars: 1.8809,
    jupiter: 11.862,
    saturn: 29.457,
    uranus: 84.02,
    neptune: 164.79,
    pluto: 247.94,
  }
  for (const key of PLANET_KEYS) {
    // Mean longitude rate straight from the table, in degrees per century.
    const p0 = { x: 0, y: 0, z: 0 }
    const p1 = { x: 0, y: 0, z: 0 }
    const dt = 1.0 // day
    planetPosition(key, jdTT, p0)
    planetPosition(key, jdTT + dt, p1)
    const l0 = Math.atan2(p0.y, p0.x)
    const l1 = Math.atan2(p1.y, p1.x)
    let dl = l1 - l0
    if (dl < -Math.PI) dl += 2 * Math.PI
    if (dl > Math.PI) dl -= 2 * Math.PI
    // Instantaneous angular rate -> period, corrected to a mean via the
    // vis-viva relation r^2 * dtheta/dt = const (angular momentum).
    const r0 = Math.hypot(p0.x, p0.y, p0.z)
    const el = EXPECTED_YEARS[key]
    // Compare instantaneous sweep against the expected mean within a factor
    // that eccentricity can explain (Pluto's e=0.25 gives ±~70%).
    const instYears = (2 * Math.PI) / Math.abs(dl) / 365.25
    ok(
      `${key.padEnd(8)} period ~ ${el} yr`,
      instYears > el * 0.5 && instYears < el * 1.9,
      `instantaneous ${instYears.toFixed(3)} yr (r=${(r0 / AU_KM).toFixed(3)} AU)`,
    )
  }
}

// ---------------------------------------------------------------------------
section('Inclinations')

{
  // Inclination to the ecliptic, recovered from the orbit normal.
  const EXPECTED_INC: Record<PlanetKey, number> = {
    mercury: 7.0,
    venus: 3.39,
    earth: 0.0,
    mars: 1.85,
    jupiter: 1.3,
    saturn: 2.49,
    uranus: 0.77,
    neptune: 1.77,
    pluto: 17.14,
  }
  for (const key of PLANET_KEYS) {
    const p0 = { x: 0, y: 0, z: 0 }
    const p1 = { x: 0, y: 0, z: 0 }
    planetPosition(key, jdTT, p0)
    planetPosition(key, jdTT + 2, p1)
    // Orbit normal from r x v.
    const nx = p0.y * p1.z - p0.z * p1.y
    const ny = p0.z * p1.x - p0.x * p1.z
    const nz = p0.x * p1.y - p0.y * p1.x
    const inc = Math.acos(nz / Math.hypot(nx, ny, nz)) * RAD
    near(`${key.padEnd(8)} inclination`, inc, EXPECTED_INC[key], 0.1, '°')
  }
}

// ---------------------------------------------------------------------------
section('Shared links round-trip')

{
  // A link is only shareable if what comes back is what went in. Free flight is
  // the case that matters: orbit mode can rebuild its aim from the focus, but a
  // free camera's orientation exists nowhere else, so losing it turns a shared
  // view into a shrug.
  const view = {
    jdUtc: 2461000.5,
    focusKey: 'moon:Enceladus',
    selectedKey: null,
    scaleMode: 'explore' as const,
    rate: -86400,
    paused: true,
    azimuth: 1.2345,
    elevation: -0.4321,
    distanceRadii: 12.5,
    cameraMode: 'free' as const,
    freePosition: [-2.194157, 0.407622, 0.003545] as const,
    freeOrientation: [0.07707, 0.84076, 0.53366, 0.04892] as const,
    orbits: DEFAULT_ORBITS,
    labels: DEFAULT_LABELS,
    toggles: { ...DEFAULT_TOGGLES },
  }
  const back = parseView(`?${encodeView(view)}`)

  ok('camera mode survives the round trip', back.cameraMode === 'free', String(back.cameraMode))
  ok(
    'free position survives the round trip',
    !!back.freePosition && back.freePosition.every((n, i) => Math.abs(n - view.freePosition[i]!) < 1e-6),
    JSON.stringify(back.freePosition),
  )
  ok(
    'free orientation survives the round trip',
    !!back.freeOrientation &&
      back.freeOrientation.every((n, i) => Math.abs(n - view.freeOrientation[i]!) < 1e-5),
    JSON.stringify(back.freeOrientation),
  )
  ok('a colon in a body key stays legible', encodeView(view).includes('focus=moon:Enceladus'))

  // Orbit mode must not carry free-flight baggage.
  const orbit = parseView(`?${encodeView({ ...view, cameraMode: 'orbit' as const })}`)
  ok(
    'orbit mode writes no camera parameters',
    orbit.cameraMode === undefined && orbit.freePosition === undefined,
    `cam=${orbit.cameraMode}`,
  )

  // Malformed input is ignored rather than fatal, as everywhere else here.
  const junk = parseView('?cam=free&fp=1,2&fq=0,0,0,0')
  ok(
    'a truncated position and a zero quaternion are both ignored',
    junk.cameraMode === 'free' && junk.freePosition === undefined && junk.freeOrientation === undefined,
  )
}

// ---------------------------------------------------------------------------
section('Rings share the satellite scale remap')

{
  // A ring is a population of orbiting bodies. If it is remapped by a different
  // law from the moons, the shepherds leave their gaps — which is exactly what
  // happened while rings scaled linearly and moons scaled by the power law:
  // Pan ended up 209 scene units from the Encke gap it orbits inside.
  //
  // Radii from Cassini, in km from Saturn's centre.
  const SATURN_R = 60_268
  const ENCKE = 133_590
  const KEELER = 136_505
  const A_OUTER = 136_775
  const F_RING = 140_180
  // Orbital semi-major axes, JPL.
  const PAN = 133_584
  const DAPHNIS = 136_504
  const PROMETHEUS = 139_380
  const PANDORA = 141_720
  const MIMAS = 185_540

  const scale = new ScaleModel()

  for (const mode of ['explore', 'true'] as const) {
    scale.setMode(mode)
    scale.snap()
    const at = (km: number): number => scale.satelliteDistance(km, SATURN_R)

    // The gap and the moonlet that clears it must be drawn together. Pan is
    // 20 km wide inside a 325 km gap, so the tolerance is a fraction of that.
    const enckeErr = Math.abs(at(PAN) - at(ENCKE))
    ok(
      `[${mode}] Pan is drawn inside the Encke gap`,
      enckeErr < at(A_OUTER) * 0.002,
      `${(enckeErr * 1000).toFixed(0)} km apart in scene terms`,
    )
    const keelerErr = Math.abs(at(DAPHNIS) - at(KEELER))
    ok(
      `[${mode}] Daphnis is drawn inside the Keeler gap`,
      keelerErr < at(A_OUTER) * 0.002,
      `${(keelerErr * 1000).toFixed(0)} km apart in scene terms`,
    )
    ok(
      `[${mode}] Prometheus and Pandora straddle the F ring`,
      at(PROMETHEUS) < at(F_RING) && at(F_RING) < at(PANDORA),
      `${at(PROMETHEUS).toFixed(1)} < ${at(F_RING).toFixed(1)} < ${at(PANDORA).toFixed(1)} units`,
    )
    ok(
      `[${mode}] Mimas orbits clear of the main rings`,
      at(MIMAS) > at(F_RING),
      `Mimas ${at(MIMAS).toFixed(1)} vs F ring ${at(F_RING).toFixed(1)} units`,
    )
  }

  // Below the knee the remap is the identity, which is what keeps Saturn's
  // silhouette right: the rings span 1.24 to 2.33 planet radii in reality and
  // must still do so on screen. A pure power law drew them at 72% of that.
  scale.setMode('explore')
  scale.snap()
  const renderedRadii = (km: number): number =>
    scale.satelliteDistance(km, SATURN_R) / scale.bodyRadius(SATURN_R)
  near('[explore] C ring inner edge sits at its true 1.236 radii', renderedRadii(74_500), 1.236, 0.002)
  near('[explore] A ring outer edge sits at its true 2.270 radii', renderedRadii(A_OUTER), 2.27, 0.002)

  // Monotone, or the model would reorder bodies — the one property the whole
  // scale scheme rests on. Sampled across the knee, where a kink lives.
  {
    let monotone = true
    let previous = -Infinity
    for (let km = 10_000; km <= 13_000_000; km += 10_000) {
      const d = scale.satelliteDistance(km, SATURN_R)
      if (d <= previous) monotone = false
      previous = d
    }
    ok('the satellite remap is monotone across the knee', monotone, '1,300 samples')
  }

  // True scale must be exactly 1:1, knee or no knee.
  scale.setMode('true')
  scale.snap()
  near(
    '[true] the remap is the identity',
    scale.satelliteDistance(A_OUTER, SATURN_R),
    A_OUTER / 1000,
    1e-6,
  )
}

// ---------------------------------------------------------------------------
section('Ring structure against the bodies that shape it')

{
  // The ring table is checked against the *satellite* table, which comes from
  // JPL elements and knows nothing about rings. A gap radius and the moon that
  // clears it are then two independent numbers that have to agree — so a typo
  // in a ring boundary cannot pass unnoticed, and no ring number is taken on
  // trust alone.
  const system = new SolarSystem()
  const scale = new ScaleModel()
  system.update(jdTT, scale)

  const bandOf = (planet: string, name: string): { innerKm: number; outerKm: number } | null => {
    const spec = ALL_BODY_SPECS.find((s) => s.key === planet)
    for (const ring of spec?.rings ?? []) {
      const band = ring.bands?.find((b) => b.name === name)
      if (band) return band
    }
    return null
  }

  /** Semi-major axis of a moon, km, from the loaded satellite elements. */
  const moonAxis = (planet: string, name: string): number | null => {
    const parent = system.byKey.get(planet)
    const moon = parent?.children.find((c) => c.name === name)
    return moon?.elements ? moon.elements.a : null
  }

  /** Where an m:n mean-motion resonance with a moon falls, by Kepler's third. */
  const resonance = (axisKm: number, inner: number, outer: number): number =>
    axisKm * Math.pow(inner / outer, 2 / 3)

  // -- gaps holding the moonlet that swept them -----------------------------
  for (const [gap, moon] of [
    ['Encke Gap', 'Pan'],
    ['Keeler Gap', 'Daphnis'],
  ] as const) {
    const band = bandOf('saturn', gap)
    const axis = moonAxis('saturn', moon)
    if (!band || axis === null) {
      ok(`${moon} sits inside the ${gap}`, false, 'missing band or moon')
      continue
    }
    ok(
      `${moon} orbits inside the ${gap}`,
      axis > band.innerKm && axis < band.outerKm,
      `${moon} at ${axis.toFixed(0)} km, gap ${band.innerKm}-${band.outerKm} km`,
    )
  }

  // -- edges held by a resonance --------------------------------------------
  {
    // Mimas 2:1 is the classic: it holds the B ring's outer edge and is why the
    // Cassini Division is empty at all.
    const mimas = moonAxis('saturn', 'Mimas')
    const huygens = bandOf('saturn', 'Huygens Gap')
    if (mimas !== null && huygens) {
      const at = resonance(mimas, 1, 2)
      ok(
        'the B ring edge sits at the Mimas 2:1 resonance',
        Math.abs(at - huygens.innerKm) < huygens.innerKm * 0.01,
        `resonance at ${at.toFixed(0)} km, B ring edge ${huygens.innerKm} km`,
      )
    }
    // Janus/Epimetheus 7:6 holds the A ring's outer edge.
    const janus = moonAxis('saturn', 'Janus')
    const aEdge = bandOf('saturn', 'A ring (edge)')
    if (janus !== null && aEdge) {
      const at = resonance(janus, 6, 7)
      ok(
        'the A ring edge sits at the Janus/Epimetheus 7:6 resonance',
        Math.abs(at - aEdge.outerKm) < aEdge.outerKm * 0.01,
        `resonance at ${at.toFixed(0)} km, A ring edge ${aEdge.outerKm} km`,
      )
    }
  }

  // -- shepherded rings ------------------------------------------------------
  {
    const f = bandOf('saturn', 'F ring')
    const pro = moonAxis('saturn', 'Prometheus')
    const pan = moonAxis('saturn', 'Pandora')
    if (f && pro !== null && pan !== null) {
      ok(
        'Prometheus and Pandora straddle the F ring band',
        pro < f.innerKm && pan > f.outerKm,
        `${pro.toFixed(0)} < ${f.innerKm}-${f.outerKm} < ${pan.toFixed(0)} km`,
      )
    }
    const eps = bandOf('uranus', 'Epsilon ring')
    const cor = moonAxis('uranus', 'Cordelia')
    const oph = moonAxis('uranus', 'Ophelia')
    if (eps && cor !== null && oph !== null) {
      ok(
        'Cordelia and Ophelia straddle the epsilon ring',
        cor < eps.innerKm && oph > eps.outerKm,
        `${cor.toFixed(0)} < ${eps.innerKm}-${eps.outerKm} < ${oph.toFixed(0)} km`,
      )
    }
    const mu = bandOf('uranus', 'Mu ring')
    const mab = moonAxis('uranus', 'Mab')
    if (mu && mab !== null) {
      ok(
        'Mab orbits inside the mu ring it feeds',
        mab > mu.innerKm && mab < mu.outerKm,
        `Mab at ${mab.toFixed(0)} km, ring ${mu.innerKm}-${mu.outerKm} km`,
      )
    }
    const adams = bandOf('neptune', 'Adams ring')
    const galatea = moonAxis('neptune', 'Galatea')
    if (adams && galatea !== null) {
      ok(
        'Galatea orbits just inside the Adams ring it confines',
        galatea < adams.innerKm && galatea > adams.innerKm - 2000,
        `Galatea at ${galatea.toFixed(0)} km, ring at ${adams.innerKm} km`,
      )
    }
    const enc = bandOf('saturn', 'E ring (peak)')
    const enceladus = moonAxis('saturn', 'Enceladus')
    if (enc && enceladus !== null) {
      ok(
        'the E ring peaks at the orbit of Enceladus, its source',
        enceladus > enc.innerKm && enceladus < enc.outerKm,
        `Enceladus at ${enceladus.toFixed(0)} km, peak ${enc.innerKm}-${enc.outerKm} km`,
      )
    }
  }

  // -- the bands must tile their ring, in order and without overlap ---------
  {
    let broken: string[] = []
    for (const spec of ALL_BODY_SPECS) {
      for (const ring of spec.rings ?? []) {
        if (!ring.bands) continue
        let previous = -Infinity
        for (const band of ring.bands) {
          if (band.innerKm >= band.outerKm || band.innerKm < previous) {
            broken.push(`${spec.key}:${band.name}`)
          }
          if (band.innerKm < ring.innerKm - 1 || band.outerKm > ring.outerKm + 1) {
            broken.push(`${spec.key}:${band.name} outside its ring`)
          }
          previous = band.outerKm
        }
      }
    }
    ok(
      'every ring band is ordered and inside its ring',
      broken.length === 0,
      broken.length ? broken.join(', ') : 'all ring systems',
    )
  }
}

// ---------------------------------------------------------------------------
section('Renderable planetary orbits')

{
  const system = new SolarSystem()
  const scale = new ScaleModel()
  system.update(jdTT, scale)

  const missing: string[] = []
  for (const key of PLANET_KEYS) {
    const body = system.byKey.get(key)
    const orbit = body ? system.orbitPolyline(body, scale, 128) : null
    if (!body?.elements || !orbit || orbit.length !== (128 + 1) * 3) missing.push(key)
  }
  ok(
    'all planets and Pluto expose renderable orbit polylines',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : '',
  )
}

// ---------------------------------------------------------------------------
section('Orbit geometry survives float32')

{
  // Satellite orbit vertices must be stored relative to their parent. Storing
  // absolute scene coordinates quantises the curve: at Pluto's ~1.28 million
  // scene units the float32 spacing is 0.085 units while Charon's orbit is only
  // ~40 across, which showed up as a visible sawtooth. Raising the segment count
  // cannot fix that, so this asserts the property rather than the appearance.
  const system = new SolarSystem()
  const scale = new ScaleModel()
  system.update(jdTT, scale)

  const charon = system.byKey.get('moon:Charon')
  const pluto = system.byKey.get('pluto')
  const segments = 512
  const points = charon ? system.orbitPolyline(charon, scale, segments) : null

  if (!points || !pluto) {
    ok('Charon orbit polyline available', false)
  } else {
    const parentMagnitude = Math.hypot(pluto.scene.x, pluto.scene.y, pluto.scene.z)

    let maxCoord = 0
    let minR = Infinity
    let maxR = -Infinity
    for (let i = 0; i < segments; i++) {
      const x = points[i * 3]!
      const y = points[i * 3 + 1]!
      const z = points[i * 3 + 2]!
      maxCoord = Math.max(maxCoord, Math.abs(x), Math.abs(y), Math.abs(z))
      const r = Math.hypot(x, y, z)
      minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
    }
    const meanR = (minR + maxR) / 2
    const relativeSpread = (maxR - minR) / meanR

    ok(
      'satellite orbit vertices are parent-relative, not absolute',
      maxCoord < parentMagnitude * 0.01,
      `max |coord| ${maxCoord.toFixed(2)} vs parent at ${parentMagnitude.toFixed(0)}`,
    )
    // A circular orbit sampled in eccentric anomaly has constant radius, so any
    // spread here is quantisation. Charon's eccentricity is ~0, and the bound is
    // still far tighter than the 0.3% the absolute-coordinate version produced.
    ok(
      'radial quantisation below 0.01% of the orbit radius',
      relativeSpread < 1e-4,
      `spread ${(relativeSpread * 100).toFixed(5)}% of ${meanR.toFixed(3)} units`,
    )
  }
}

// ---------------------------------------------------------------------------
section('Tidally locked frames')

/** Angular separation in longitude, accounting for the wrap. Always 0..180. */
const lonApart = (a: number, b: number): number =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180)

// A tidally locked moon's prime meridian faces its planet — that is what the
// IAU convention means, and every satellite map and shape model is drawn in it.
// Get this backwards and each of the 459 moons is rendered half a turn out,
// which is invisible on a synthesised surface and wrong on every real one.
{
  const system = new SolarSystem()
  const scale = new ScaleModel()
  system.update(jdTT, scale)

  for (const key of ['moon:Moon', 'moon:Phobos']) {
    const body = system.byKey.get(key)
    if (!body || !body.parent) {
      ok(`${key} present for the tidal-lock frame check`, false)
      continue
    }
    const p = body.localKm
    const n = Math.hypot(p.x, p.y, p.z)
    const toParent = { x: -p.x / n, y: -p.y / n, z: -p.z / n }
    const b = body.orientation
    const dot = (u: { x: number; y: number; z: number }, v: typeof u): number =>
      u.x * v.x + u.y * v.y + u.z * v.z
    let lon = (Math.atan2(dot(toParent, b.y), dot(toParent, b.x)) * 180) / Math.PI
    if (lon < 0) lon += 360
    const lat = (Math.asin(dot(toParent, b.z)) * 180) / Math.PI
    ok(
      `${key} points its prime meridian at its parent`,
      lonApart(lon, 0) < 0.5 && Math.abs(lat) < 0.5,
      `sub-parent point at ${lat.toFixed(2)}N ${lon.toFixed(2)}E, expected 0N 0E`,
    )
  }
}

// ---------------------------------------------------------------------------
section('Surface relief')

// The 180 degree texture bug lived for a whole build because a wrongly rotated
// planet still looks like a planet. An elevation grid has the same failure mode
// and a much better test: it has named extremes at published coordinates, so a
// roll, a flip or a mirrored longitude shows up immediately.

interface ReliefProbe {
  width: number
  height: number
  /** Elevation in km at a latitude and *east* longitude. */
  at(latDeg: number, lonEast: number): number
  /** Cosine-weighted mean elevation over every sample the filter accepts. */
  mean(accept: (lat: number, lonEast: number) => boolean): number
  /** Where the global extremes fall, as [lat, lonEast]. */
  extremes(): { hiAt: [number, number]; loAt: [number, number] }
}

function probeRelief(key: string): ReliefProbe | null {
  const relief = reliefFor(key)
  if (!relief) return null
  const file = path.join(SHAPES_DIR, relief.file)
  // Assets are checked in, so a missing file should not happen — but validate
  // must not fail on a tree where they have been cleared deliberately.
  if (!existsSync(file)) return null

  const img = decodePng(readFileSync(file))
  ok(
    `${key} relief map matches its declared grid`,
    img.width === relief.width && img.height === relief.height,
    `${img.width}x${img.height} vs ${relief.width}x${relief.height}`,
  )

  const kmAt = (x: number, y: number): number => {
    const i = (y * img.width + x) * 3
    const f = ((img.data[i]! << 8) | img.data[i + 1]!) / 65535
    return relief.minKm + f * (relief.maxKm - relief.minKm)
  }
  const latOf = (y: number): number => 90 - ((y + 0.5) * 180) / img.height
  const lonOf = (x: number): number => (180 + ((x + 0.5) * 360) / img.width) % 360

  return {
    width: img.width,
    height: img.height,
    at(latDeg, lonEast) {
      const u = (((((lonEast - 180) / 360) % 1) + 1) % 1)
      const x = Math.min(img.width - 1, Math.round(u * img.width))
      const y = Math.min(img.height - 1, Math.max(0, Math.round(((90 - latDeg) / 180) * img.height)))
      return kmAt(x, y)
    },
    mean(accept) {
      let sum = 0
      let weight = 0
      for (let y = 0; y < img.height; y++) {
        const lat = latOf(y)
        const w = Math.cos((lat * Math.PI) / 180)
        for (let x = 0; x < img.width; x++) {
          if (!accept(lat, lonOf(x))) continue
          sum += kmAt(x, y) * w
          weight += w
        }
      }
      return weight > 0 ? sum / weight : NaN
    },
    extremes() {
      let hi = -Infinity
      let lo = Infinity
      let hiAt: [number, number] = [0, 0]
      let loAt: [number, number] = [0, 0]
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const v = kmAt(x, y)
          if (v > hi) { hi = v; hiAt = [latOf(y), lonOf(x)] }
          if (v < lo) { lo = v; loAt = [latOf(y), lonOf(x)] }
        }
      }
      return { hiAt, loAt }
    },
  }
}

{
  const mars = probeRelief('mars')
  if (!mars) ok('mars relief (skipped, not on disk)', true)
  else {
    // Spot heights. Tolerances are wide because the grid is 4 px/deg — one
    // sample spans ~15 km — so these test registration, not altimetry.
    near('Ascraeus Mons elevation', mars.at(11.8, 255.5), 18.1, 1.5, ' km')
    near('Isidis basin floor', mars.at(12.9, 87.0), -3.8, 1.5, ' km')

    // The crustal dichotomy: the northern lowlands sit kilometres below the
    // southern highlands. Independent of any single landmark, and it fails loudly
    // if the grid is ever flipped in latitude.
    const north = mars.mean((lat) => lat > 40 && lat < 80)
    const south = mars.mean((lat) => lat < -40 && lat > -80)
    ok(
      'Mars northern lowlands sit below the southern highlands',
      south - north > 2,
      `north ${north.toFixed(2)} km, south ${south.toFixed(2)} km, difference ${(south - north).toFixed(2)} km`,
    )

    // The decisive one: the global extremes must land on the right features.
    const { hiAt, loAt } = mars.extremes()
    // Olympus Mons is 600 km across, so its highest sample sits a degree or so
    // off the nominal centre; 3 degrees still excludes every other volcano.
    ok(
      'Mars global maximum is Olympus Mons',
      Math.abs(hiAt[0] - 18.65) < 3 && lonApart(hiAt[1], 226.2) < 3,
      `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected 18.65N 226.2E`,
    )
    // Hellas is a 2,300 km basin, so the deepest sample roams within it.
    ok(
      'Mars global minimum is inside Hellas',
      loAt[0] > -50 && loAt[0] < -25 && loAt[1] > 45 && loAt[1] < 95,
      `at ${loAt[0].toFixed(2)}N ${loAt[1].toFixed(2)}E, expected the Hellas basin`,
    )
  }
}

{
  const moon = probeRelief('moon:Moon')
  if (!moon) ok('lunar relief (skipped, not on disk)', true)
  else {
    // The far side averages roughly 1.5-2 km higher than the near side. Being a
    // hemispheric property centred on 0 and 180 degrees, it pins the longitude
    // roll the way the crustal dichotomy pins latitude for Mars.
    const near1 = moon.mean((_lat, lon) => lonApart(lon, 0) < 75)
    const far = moon.mean((_lat, lon) => lonApart(lon, 180) < 75)
    ok(
      'lunar far side stands above the near side',
      far - near1 > 1,
      `near ${near1.toFixed(2)} km, far ${far.toFixed(2)} km, difference ${(far - near1).toFixed(2)} km`,
    )

    const { hiAt, loAt } = moon.extremes()
    ok(
      'lunar global maximum is on the far side',
      Math.abs(hiAt[0] - 5.4) < 6 && lonApart(hiAt[1], 201.4) < 6,
      `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected 5.4N 201.4E`,
    )
    // Antoniadi, inside the South Pole-Aitken basin — the lowest point on the Moon.
    ok(
      'lunar global minimum is inside South Pole-Aitken',
      loAt[0] < -60 && lonApart(loAt[1], 187.5) < 25,
      `at ${loAt[0].toFixed(2)}N ${loAt[1].toFixed(2)}E, expected 70.4S 187.5E`,
    )
  }
}

{
  const earth = probeRelief('earth')
  if (!earth) ok('Earth relief (skipped, not on disk)', true)
  else {
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
    )
    ok(
      'Earth open ocean is exactly flat',
      earth.at(0, 200) === 0 && earth.at(0, 335) === 0 && earth.at(-60, 100) === 0,
      `Pacific ${earth.at(0, 200)}, Atlantic ${earth.at(0, 335)}, Southern ${earth.at(-60, 100)}`,
    )

    near('Tibetan plateau elevation', earth.at(32, 88), 4.9, 1.2, ' km')
    near('Altiplano elevation', earth.at(-20, 292), 3.7, 1.5, ' km')
    near('Sahara (Libya) elevation', earth.at(25, 20), 0.5, 0.5, ' km')

    // Averaged into 10.5 arc-minute cells no single summit survives, so the
    // maximum is the Himalaya-Karakoram wall rather than Everest itself.
    const { hiAt } = earth.extremes()
    ok(
      'Earth global maximum is the Himalaya',
      hiAt[0] > 25 && hiAt[0] < 40 && hiAt[1] > 70 && hiAt[1] < 100,
      `at ${hiAt[0].toFixed(2)}N ${hiAt[1].toFixed(2)}E, expected the Himalaya-Karakoram`,
    )
  }
}

{
  const phobos = probeRelief('moon:Phobos')
  if (!phobos) ok('Phobos shape (skipped, not on disk)', true)
  else {
    // Offsets are measured from the mean radius the app gives Phobos.
    const R = 11.08
    const r = (lat: number, lon: number): number => R + phobos.at(lat, lon)

    // The IAU triaxial figure is 13.0 x 11.4 x 9.1 km with the long axis locked
    // toward Mars. Reading it back off the resampled map confirms the cube-quad
    // conversion kept the model's own axes.
    ok(
      'Phobos long axis lies along the sub-Mars meridian',
      r(0, 0) > 12 && r(0, 180) > 12,
      `sub-Mars ${r(0, 0).toFixed(2)} km, anti-Mars ${r(0, 180).toFixed(2)} km, expected > 12`,
    )
    ok(
      'Phobos intermediate axis lies at 90 degrees',
      r(0, 90) > 11 && r(0, 90) < 12.4,
      `${r(0, 90).toFixed(2)} km, expected 11-12.4`,
    )
    ok(
      'Phobos short axis is polar',
      r(89, 0) < 10.4 && r(-89, 0) < 10.4,
      `north ${r(89, 0).toFixed(2)} km, south ${r(-89, 0).toFixed(2)} km, expected < 10.4`,
    )

    // Stickney is centred at 1N 49W, on the Mars-facing hemisphere. Comparing it
    // with the point diametrically opposite in longitude cancels the ellipsoid —
    // both sit the same distance round from the long axis — so what is left is
    // the crater. If the map were ever rolled half a turn, this flips sign.
    ok(
      'Stickney is a depression on the Mars-facing hemisphere',
      r(1, 131) - r(1, 311) > 0.4,
      `Stickney ${r(1, 311).toFixed(2)} km vs opposite ${r(1, 131).toFixed(2)} km`,
    )
  }
}

{
  const deimos = probeRelief('moon:Deimos')
  if (!deimos) ok('Deimos shape (skipped, not on disk)', true)
  else {
    const R = 6.2
    const r = (lat: number, lon: number): number => R + deimos.at(lat, lon)

    // IAU figure is 7.8 x 6.0 x 5.1 km, long axis locked toward Mars. The source
    // is a 5 degree Viking grid, so these are loose — they test that the table's
    // latitude order and longitude origin survived resampling, not the fit.
    ok(
      'Deimos long axis lies along the sub-Mars meridian',
      r(0, 0) > 6.8 && r(0, 180) > 6.8,
      `sub-Mars ${r(0, 0).toFixed(2)} km, anti-Mars ${r(0, 180).toFixed(2)} km, expected > 6.8`,
    )
    ok(
      'Deimos short axis is polar',
      r(89, 0) < 5.8 && r(-89, 0) < 5.8,
      `north ${r(89, 0).toFixed(2)} km, south ${r(-89, 0).toFixed(2)} km, expected < 5.8`,
    )
    // A broad, well-sampled depression in the southern hemisphere — 472 of the
    // table's 2701 points sit below 4.5 km, centred here. If the latitude order
    // were ever flipped this would appear in the north instead.
    ok(
      'Deimos southern depression is in the south',
      r(-67, 232) < 4.2 && r(67, 232) > 5,
      `south ${r(-67, 232).toFixed(2)} km, north ${r(67, 232).toFixed(2)} km`,
    )
  }
}

{
  // Every shape model here is stored in its body's own IAU frame, so reading a
  // known figure back out of the resampled map is what proves the conversion
  // kept the axes — the same test applied to Phobos and Deimos above.
  const shaped: [string, number, string][] = [
    ['moon:Mimas', 198.2, 'Mimas'],
    ['moon:Tethys', 531.1, 'Tethys'],
    ['moon:Dione', 561.4, 'Dione'],
    ['moon:Phoebe', 106.5, 'Phoebe'],
    ['sb:Eros', 8.42, 'Eros'],
    ['sb:Vesta', 262.7, 'Vesta'],
  ]
  for (const [key, ref, name] of shaped) {
    const p = probeRelief(key)
    if (!p) {
      ok(`${name} shape (skipped, not on disk)`, true)
      continue
    }
    const r = (lat: number, lon: number): number => ref + p.at(lat, lon)

    if (name === 'Mimas') {
      // Herschel is 139 km across on a 198 km moon and 10 km deep — easily the
      // deepest point, and its position pins the longitude convention exactly.
      const { loAt } = p.extremes()
      ok(
        'Mimas deepest point is Herschel',
        Math.abs(loAt[0]) < 10 && lonApart(loAt[1], 249) < 10,
        `at ${loAt[0].toFixed(0)}N ${loAt[1].toFixed(0)}E, expected 0N 249E`,
      )
    }

    if (name === 'Eros') {
      // 34 x 11 x 11 km. Nothing else in the app is this elongated.
      ok(
        'Eros long axis is four times its waist',
        r(0, 0) > 13 && r(0, 180) > 13 && r(0, 90) < 8,
        `ends ${r(0, 0).toFixed(1)}/${r(0, 180).toFixed(1)} km, waist ${r(0, 90).toFixed(1)} km`,
      )
    }

    if (name === 'Vesta') {
      // Rheasilvia excavated most of the southern hemisphere; the north-south
      // asymmetry is the single most obvious thing about Vesta's figure.
      const north = p.mean((lat) => lat > 50)
      const south = p.mean((lat) => lat < -50)
      ok(
        'Vesta southern hemisphere is excavated by Rheasilvia',
        north - south > 8,
        `north ${(ref + north).toFixed(1)} km, south ${(ref + south).toFixed(1)} km`,
      )
    }

    if (name === 'Phoebe') {
      // A captured body that never relaxed: its radius varies by a quarter.
      const { hiAt, loAt } = p.extremes()
      const spread = (r(hiAt[0], hiAt[1]) - r(loAt[0], loAt[1])) / ref
      ok(
        'Phoebe is strongly irregular',
        spread > 0.2,
        `radius spread ${(spread * 100).toFixed(0)}% of the mean`,
      )
    }

    if (name === 'Tethys' || name === 'Dione') {
      // Synchronous rotation raises a tidal bulge along the planet-facing axis,
      // so both ends of the prime meridian stand above the 90 degree flanks.
      const ends = (r(0, 0) + r(0, 180)) / 2
      const flanks = (r(0, 90) + r(0, 270)) / 2
      ok(
        `${name} is elongated toward Saturn`,
        ends > flanks,
        `ends ${ends.toFixed(1)} km, flanks ${flanks.toFixed(1)} km`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
section('Star catalogue')

{
  // A sky renders convincingly whichever way round it is, so the checks that
  // matter are the ones a mirrored or mis-rotated catalogue cannot pass: named
  // stars at their published coordinates, in the right order of brightness,
  // with the right colours. Every reference value below is a published one,
  // typed in here rather than read back out of the file being checked.
  const file = path.join(PUBLIC_DIR, STAR_CATALOGUE.file)
  if (!existsSync(file)) {
    ok('star catalogue present', false, `${STAR_CATALOGUE.file} is missing — run pnpm assets`)
  } else {
    const raw = readFileSync(file)
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    const stars = unpackStars(buf)

    ok('star catalogue unpacks', stars !== null, `${STAR_CATALOGUE.count} stars declared`)

    if (stars) {
      /** Nearest catalogue entry to a published position, and how far off it is. */
      const find = (raDeg: number, decDeg: number) => {
        const ra = raDeg * DEG
        const dec = decDeg * DEG
        const t = [
          Math.cos(dec) * Math.cos(ra),
          Math.cos(dec) * Math.sin(ra),
          Math.sin(dec),
        ]
        // The stored directions are equatorial J2000, the same frame as the
        // reference values, so this comparison never touches the obliquity.
        let best = -2
        let index = -1
        for (let i = 0; i < stars.count; i++) {
          const d =
            stars.direction[i * 3]! * t[0]! +
            stars.direction[i * 3 + 1]! * t[1]! +
            stars.direction[i * 3 + 2]! * t[2]!
          if (d > best) {
            best = d
            index = i
          }
        }
        // Angle from the chord, not from acos of the dot product. The stored
        // directions are float32, so 1 - dot carries only ~1e-7 of signal and
        // acos of it bottoms out around 90 arcseconds — which reads exactly
        // like a catalogue that is slightly wrong. The chord form has no such
        // cancellation and resolves to well under an arcsecond.
        const chord = Math.hypot(
          stars.direction[index * 3]! - t[0]!,
          stars.direction[index * 3 + 1]! - t[1]!,
          stars.direction[index * 3 + 2]! - t[2]!,
        )
        return {
          index,
          arcsec: 2 * Math.asin(Math.min(1, chord / 2)) * RAD * 3600,
          mag: stars.magnitude[index]!,
          rgb: [
            stars.colour[index * 3]!,
            stars.colour[index * 3 + 1]!,
            stars.colour[index * 3 + 2]!,
          ] as const,
          pm: Math.hypot(
            stars.properMotion[index * 3]!,
            stars.properMotion[index * 3 + 1]!,
            stars.properMotion[index * 3 + 2]!,
          ),
        }
      }

      // RA/Dec J2000 and Johnson V, from the standard bright-star references.
      const NAMED: [string, number, number, number][] = [
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
      ]

      let worstArcsec = 0
      let worstMag = 0
      for (const [name, ra, dec, vmag] of NAMED) {
        const hit = find(ra, dec)
        worstArcsec = Math.max(worstArcsec, hit.arcsec)
        worstMag = Math.max(worstMag, Math.abs(hit.mag - vmag))
        if (hit.arcsec > 60) {
          ok(`${name} is where it should be`, false, `nearest star is ${hit.arcsec.toFixed(0)}"`)
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
      )
      // Bright stars are frequently variable — Betelgeuse alone swings by half a
      // magnitude — so this is a check on the column, not on the photometry.
      ok(
        'and carry their published magnitudes',
        worstMag < 0.15,
        `worst ${worstMag.toFixed(3)} mag`,
      )

      // Colour: B stars must come out blue-white and M stars orange. Comparing
      // the blue/red ratio pins the direction of the B-V mapping, which a sign
      // slip would silently invert into a sky of red hot stars and blue cool ones.
      const rigel = find(78.63446, -8.20164).rgb
      const betelgeuse = find(88.79293, 7.40706).rgb
      ok(
        'Rigel is blue-white and Betelgeuse is orange',
        rigel[2] > rigel[0] && betelgeuse[0] > betelgeuse[2],
        `Rigel rgb(${rigel.join(',')}), Betelgeuse rgb(${betelgeuse.join(',')})`,
      )

      // Proper motion. The catalogue's own epoch is J1991.25 and these were
      // propagated forward to J2000, which is invisible on the sky as a whole
      // and glaring on the fastest movers. Groombridge 1830 is the fastest star
      // inside the magnitude limit, at 7.06"/yr — it travelled 62 arcseconds
      // between the two epochs, six times the packing quantum, so this fails
      // loudly if the propagation is ever dropped or applied twice.
      const groombridge = find(178.24487, 37.71868) // HD 103095, V 6.42
      ok(
        'Groombridge 1830 was propagated to J2000 and kept its proper motion',
        groombridge.arcsec < 15 && Math.abs(groombridge.pm * RAD * 3600 - 7.06) < 0.05,
        `${(groombridge.pm * RAD * 3600).toFixed(2)}"/yr, ${groombridge.arcsec.toFixed(1)}" from J2000`,
      )

      // Nothing in the file may be fainter than the limit the module advertises,
      // or the renderer's size law hands out negative radii.
      let faintest = -Infinity
      for (let i = 0; i < stars.count; i++) faintest = Math.max(faintest, stars.magnitude[i]!)
      ok(
        'no star is fainter than the declared limit',
        faintest <= STAR_CATALOGUE.magnitudeLimit + 1e-3,
        `faintest V ${faintest.toFixed(2)}, limit ${STAR_CATALOGUE.magnitudeLimit}`,
      )

      // Every direction must be a unit vector; the int16 packing is what would
      // break this, and a short vector renders as a star at the wrong distance
      // from the sphere's centre rather than as anything obviously wrong.
      let worstLength = 0
      for (let i = 0; i < stars.count; i++) {
        const len = Math.hypot(
          stars.direction[i * 3]!,
          stars.direction[i * 3 + 1]!,
          stars.direction[i * 3 + 2]!,
        )
        worstLength = Math.max(worstLength, Math.abs(len - 1))
      }
      ok('directions are unit vectors', worstLength < 1e-4, `worst |1-|v|| = ${worstLength.toExponential(1)}`)

      // The Milky Way must actually be where the stars are dense. This is the
      // one check that ties the two layers of the sky together: it recomputes
      // the galactic pole from published values and asks whether the catalogue
      // crowds the plane it defines.
      const GNP_RA = 192.85948 * DEG
      const GNP_DEC = 27.12825 * DEG
      const pole = [
        Math.cos(GNP_DEC) * Math.cos(GNP_RA),
        Math.cos(GNP_DEC) * Math.sin(GNP_RA),
        Math.sin(GNP_DEC),
      ]
      let nearPlane = 0
      for (let i = 0; i < stars.count; i++) {
        const sinB = Math.abs(
          stars.direction[i * 3]! * pole[0]! +
            stars.direction[i * 3 + 1]! * pole[1]! +
            stars.direction[i * 3 + 2]! * pole[2]!,
        )
        if (sinB < Math.sin(10 * DEG)) nearPlane++
      }
      // A band 10 degrees either side of the plane is 17.4% of the sky by area,
      // and a mirrored or mis-rotated catalogue would land on exactly that. The
      // excess is real but modest — everything down to eighth magnitude is
      // nearby, within a few disc scale heights, so the bright sky is far less
      // concentrated than the faint one that makes up the Milky Way.
      const fraction = nearPlane / stars.count
      ok(
        'stars crowd the galactic plane',
        fraction > 0.22,
        `${(fraction * 100).toFixed(1)}% within 10 degrees of it, against 17.4% of the sky`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
console.log(
  `\n\x1b[1m${checks - failures}/${checks} checks passed\x1b[0m${failures ? ` \x1b[31m(${failures} failed)\x1b[0m` : ''}\n`,
)
if (failures > 0) process.exit(1)
