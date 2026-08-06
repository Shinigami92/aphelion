/**
 * Time scale conversions: UTC <-> Julian Date <-> Terrestrial Time.
 *
 * Dynamics need TT; humans read UTC. The offset between them is
 *   TT - UTC = 32.184 s + (TAI - UTC)
 * where (TAI - UTC) is the integer count of leap seconds. Before 1972 there
 * were no leap seconds, so we fall back to the Espenak & Meeus dT polynomials
 * (dT = TT - UT), which is what historical eclipse work uses.
 */

import { JD_UNIX_EPOCH, MS_PER_DAY, SEC_PER_DAY } from '../core/constants.ts'

/** Leap seconds: [UTC Julian Date of introduction, TAI - UTC seconds]. */
const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = [
  [2441317.5, 10], // 1972-01-01
  [2441499.5, 11], // 1972-07-01
  [2441683.5, 12], // 1973-01-01
  [2442048.5, 13], // 1974-01-01
  [2442413.5, 14], // 1975-01-01
  [2442778.5, 15], // 1976-01-01
  [2443144.5, 16], // 1977-01-01
  [2443509.5, 17], // 1978-01-01
  [2443874.5, 18], // 1979-01-01
  [2444239.5, 19], // 1980-01-01
  [2444786.5, 20], // 1981-07-01
  [2445151.5, 21], // 1982-07-01
  [2445516.5, 22], // 1983-07-01
  [2446247.5, 23], // 1985-07-01
  [2447161.5, 24], // 1988-01-01
  [2447892.5, 25], // 1990-01-01
  [2448257.5, 26], // 1991-01-01
  [2448804.5, 27], // 1992-07-01
  [2449169.5, 28], // 1993-07-01
  [2449534.5, 29], // 1994-07-01
  [2450083.5, 30], // 1996-01-01
  [2450630.5, 31], // 1997-07-01
  [2451179.5, 32], // 1999-01-01
  [2453736.5, 33], // 2006-01-01
  [2454832.5, 34], // 2009-01-01
  [2456109.5, 35], // 2012-07-01
  [2457204.5, 36], // 2015-07-01
  [2457754.5, 37], // 2017-01-01
]

/** TAI - UTC in seconds for a given UTC Julian Date. */
export function taiMinusUtc(jdUTC: number): number {
  let v = 0
  for (const entry of LEAP_SECONDS) {
    if (jdUTC >= entry[0]) v = entry[1]
    else break
  }
  return v
}

/**
 * dT = TT - UT in seconds, from the Espenak & Meeus (2006) piecewise fits used
 * by NASA's eclipse canon. Only consulted outside the leap-second era.
 */
export function deltaTSeconds(year: number): number {
  const y = year

  if (y < -500) {
    const u = (y - 1820) / 100
    return -20 + 32 * u * u
  }
  if (y < 500) {
    const u = y / 100
    return (
      10583.6 +
      u *
        (-1014.41 +
          u * (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521)))))
    )
  }
  if (y < 1600) {
    const u = (y - 1000) / 100
    return (
      1574.2 +
      u *
        (-556.01 +
          u * (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073)))))
    )
  }
  if (y < 1700) {
    const t = y - 1600
    return 120 + t * (-0.9808 + t * (-0.01532 + t / 7129))
  }
  if (y < 1800) {
    const t = y - 1700
    return 8.83 + t * (0.1603 + t * (-0.0059285 + t * (0.00013336 - t / 1174000)))
  }
  if (y < 1860) {
    const t = y - 1800
    return (
      13.72 +
      t *
        (-0.332447 +
          t *
            (0.0068612 +
              t *
                (0.0041116 +
                  t * (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875))))))
    )
  }
  if (y < 1900) {
    const t = y - 1860
    return 7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174))))
  }
  if (y < 1920) {
    const t = y - 1900
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 0.000197)))
  }
  if (y < 1941) {
    const t = y - 1920
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936))
  }
  if (y < 1961) {
    const t = y - 1950
    return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547))
  }
  if (y < 1986) {
    const t = y - 1975
    return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718))
  }
  if (y < 2005) {
    const t = y - 2000
    return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))))
  }
  if (y < 2050) {
    const t = y - 2000
    return 62.92 + t * (0.32217 + t * 0.005589)
  }
  if (y < 2150) {
    const u = (y - 1820) / 100
    return -20 + 32 * u * u - 0.5628 * (2150 - y)
  }
  const u = (y - 1820) / 100
  return -20 + 32 * u * u
}

/** Approximate decimal year for a Julian Date (used only for dT lookup). */
export function jdToYearFraction(jd: number): number {
  return 2000 + (jd - 2451545.0) / 365.25
}

/** UTC Julian Date -> TT Julian Date. */
export function jdUtcToTt(jdUTC: number): number {
  const first = LEAP_SECONDS[0]
  if (first && jdUTC >= first[0]) {
    return jdUTC + (32.184 + taiMinusUtc(jdUTC)) / SEC_PER_DAY
  }
  return jdUTC + deltaTSeconds(jdToYearFraction(jdUTC)) / SEC_PER_DAY
}

/** Unix epoch milliseconds (UTC) -> Julian Date. */
export function msToJd(ms: number): number {
  return JD_UNIX_EPOCH + ms / MS_PER_DAY
}

/** Julian Date -> Unix epoch milliseconds (UTC). */
export function jdToMs(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY
}

/** Julian centuries of TT since J2000.0. */
export function centuriesSinceJ2000(jdTT: number): number {
  return (jdTT - 2451545.0) / 36525
}

/** Days of TT since J2000.0. */
export function daysSinceJ2000(jdTT: number): number {
  return jdTT - 2451545.0
}

/**
 * Greenwich Mean Sidereal Time in radians, IAU 1982 series.
 * Used as an independent check on the Earth rotation model.
 */
export function gmst(jdUT1: number): number {
  const d = jdUT1 - 2451545.0
  const t = d / 36525
  let s = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t
  s = ((s % 86400) + 86400) % 86400
  return (s / 240) * (Math.PI / 180) // 1 second of time = 1/240 degree
}

// ---------------------------------------------------------------------------
// Calendar formatting (UTC only - no locale surprises, no Date parsing quirks)
// ---------------------------------------------------------------------------

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
  ms: number
}

const p2 = (n: number) => String(Math.abs(n)).padStart(2, '0')
const p3 = (n: number) => String(Math.abs(n)).padStart(3, '0')

/**
 * Julian Date -> proleptic Gregorian UTC calendar fields, via the standard
 * Meeus inverse. Stays exact for dates far outside the range JavaScript's
 * Date handles comfortably.
 */
export function jdToCalendar(jd: number): CalendarDate {
  const z = Math.floor(jd + 0.5)
  const f = jd + 0.5 - z

  let a = z
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25)
    a = z + 1 + alpha - Math.floor(alpha / 4)
  }
  const b = a + 1524
  const c = Math.floor((b - 122.1) / 365.25)
  const d = Math.floor(365.25 * c)
  const e = Math.floor((b - d) / 30.6001)

  const dayFrac = b - d - Math.floor(30.6001 * e) + f
  const day = Math.floor(dayFrac)
  const month = e < 14 ? e - 1 : e - 13
  const year = month > 2 ? c - 4716 : c - 4715

  let rem = (dayFrac - day) * 24
  let hour = Math.floor(rem)
  rem = (rem - hour) * 60
  let minute = Math.floor(rem)
  rem = (rem - minute) * 60
  let second = Math.floor(rem)
  let msec = Math.round((rem - second) * 1000)

  // Carry rounding upward so we never render ":60".
  if (msec >= 1000) {
    msec -= 1000
    second += 1
  }
  if (second >= 60) {
    second -= 60
    minute += 1
  }
  if (minute >= 60) {
    minute -= 60
    hour += 1
  }

  return { year, month, day, hour, minute, second, ms: msec }
}

/** Proleptic Gregorian UTC calendar fields -> Julian Date. */
export function calendarToJd(c: CalendarDate): number {
  let y = c.year
  let m = c.month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  // Gregorian calendar correction applies from 1582-10-15 onward.
  const gregorian =
    c.year > 1582 || (c.year === 1582 && (c.month > 10 || (c.month === 10 && c.day >= 15)))
  const A = Math.floor(y / 100)
  const B = gregorian ? 2 - A + Math.floor(A / 4) : 0

  const dayFrac = c.day + (c.hour + (c.minute + (c.second + c.ms / 1000) / 60) / 60) / 24

  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + B - 1524.5
}

/** `YYYY-MM-DD HH:MM:SS` (UTC), with a leading `-` for BCE years. */
export function formatUtc(jd: number, withMs = false): string {
  const c = jdToCalendar(jd)
  const yr = (c.year < 0 ? '-' : '') + String(Math.abs(c.year)).padStart(4, '0')
  const base = `${yr}-${p2(c.month)}-${p2(c.day)} ${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`
  return withMs ? `${base}.${p3(c.ms)}` : base
}

export function formatUtcDate(jd: number): string {
  const c = jdToCalendar(jd)
  const yr = (c.year < 0 ? '-' : '') + String(Math.abs(c.year)).padStart(4, '0')
  return `${yr}-${p2(c.month)}-${p2(c.day)}`
}

export function formatUtcTime(jd: number): string {
  const c = jdToCalendar(jd)
  return `${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`
}

/**
 * Parse `YYYY-MM-DD[ T]HH:MM[:SS]` as UTC. Returns null when unparseable so
 * callers can reject input without throwing.
 */
export function parseUtc(text: string): number | null {
  const m =
    /^\s*(-?\d{1,6})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?)?\s*Z?\s*$/.exec(
      text,
    )
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = m[4] ? Number(m[4]) : 0
  const minute = m[5] ? Number(m[5]) : 0
  const secFloat = m[6] ? Number(m[6]) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || secFloat >= 61) {
    return null
  }
  const second = Math.floor(secFloat)
  return calendarToJd({
    year,
    month,
    day,
    hour,
    minute,
    second,
    ms: Math.round((secFloat - second) * 1000),
  })
}

/** Current wall clock as a UTC Julian Date. */
export function nowJdUtc(): number {
  return msToJd(Date.now())
}
