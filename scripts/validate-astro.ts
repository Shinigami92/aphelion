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
import { reliefFor } from '../src/data/generated/relief.ts'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const SHAPES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'shapes',
)

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

// ---------------------------------------------------------------------------
console.log(
  `\n\x1b[1m${checks - failures}/${checks} checks passed\x1b[0m${failures ? ` \x1b[31m(${failures} failed)\x1b[0m` : ''}\n`,
)
if (failures > 0) process.exit(1)
