/**
 * Physical and rendering constants.
 *
 * Unit conventions used throughout Aphelion:
 *   - Astronomical distances are in kilometres (km) as `number` (f64).
 *   - Angles are radians internally; degrees only at data/UI boundaries.
 *   - Times are Julian Dates. `jdTT` for dynamics, `jdUTC` for display.
 *   - Three.js scene units: 1 unit = SCENE_UNIT_KM kilometres.
 */

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI
export const TWO_PI = Math.PI * 2

/** Astronomical unit, IAU 2012 definition. */
export const AU_KM = 149_597_870.7

/** Julian date of J2000.0 (2000-01-01 12:00 TT). */
export const J2000 = 2451545.0

/** Days per Julian century. */
export const DAYS_PER_CENTURY = 36525.0

/** Julian date of the Unix epoch (1970-01-01 00:00 UTC). */
export const JD_UNIX_EPOCH = 2440587.5

export const MS_PER_DAY = 86_400_000
export const SEC_PER_DAY = 86_400

/** Obliquity of the ecliptic at J2000.0 (arcsec 84381.406 → radians). */
export const OBLIQUITY_J2000 = (84381.406 / 3600) * DEG

/** Speed of light, km/s — used for light-time correction. */
export const C_KM_S = 299_792.458

/** Gravitational parameters (GM), km^3/s^2. */
export const GM = {
  sun: 1.32712440018e11,
  mercury: 2.2032e4,
  venus: 3.24859e5,
  earth: 3.986004418e5,
  moon: 4.9048695e3,
  mars: 4.282837e4,
  jupiter: 1.26686534e8,
  saturn: 3.7931187e7,
  uranus: 5.793939e6,
  neptune: 6.836529e6,
  pluto: 8.71e2,
} as const

/**
 * Earth/Moon mass ratio — used to convert the Earth-Moon barycentre position
 * returned by the JPL Keplerian tables into a true geocentre.
 */
export const EARTH_MOON_MASS_RATIO = 81.30056907419062
export const MOON_BARY_FRACTION = 1 / (1 + EARTH_MOON_MASS_RATIO)

/** Solar constants. */
export const SUN_RADIUS_KM = 695_700
/** Absolute visual magnitude scaling reference: solar irradiance at 1 AU, W/m^2. */
export const SOLAR_IRRADIANCE_1AU = 1361

// ---------------------------------------------------------------------------
// Rendering scale
// ---------------------------------------------------------------------------

/**
 * One Three.js unit = 1000 km. Chosen so that:
 *   - Earth's radius is ~6.37 units (comfortable float32 range near camera),
 *   - Neptune's orbit is ~4.5e6 units (handled by the floating origin +
 *     dynamic near/far planes rather than by shrinking the world).
 */
export const SCENE_UNIT_KM = 1000

export const kmToUnits = (km: number): number => km / SCENE_UNIT_KM
export const unitsToKm = (u: number): number => u * SCENE_UNIT_KM
