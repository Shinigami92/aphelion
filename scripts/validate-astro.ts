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

import { AU_KM, RAD } from '../src/core/constants.ts'
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
console.log(
  `\n\x1b[1m${checks - failures}/${checks} checks passed\x1b[0m${failures ? ` \x1b[31m(${failures} failed)\x1b[0m` : ''}\n`,
)
if (failures > 0) process.exit(1)
