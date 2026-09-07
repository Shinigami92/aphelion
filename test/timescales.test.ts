/**
 * Time-scale conversions.
 *
 * The checks worth keeping guard the hand-maintained data (the leap-second
 * table, the stitched delta-T polynomials) and the fiddly Meeus calendar
 * inverse. A second of time is invisible to the eye and fatal to an eclipse.
 */

import { describe, it, expect } from 'vitest'
import {
  calendarToJd,
  deltaTSeconds,
  formatUtc,
  jdToCalendar,
  jdToYearFraction,
  jdUtcToTt,
  parseUtc,
  taiMinusUtc,
} from '../src/astro/timescales.ts'
import { J2000, SEC_PER_DAY } from '../src/core/constants.ts'

const utc = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number => calendarToJd({ year, month, day, hour, minute, second, ms: 0 })

const FIRST_LEAP_SECOND_JD = 2441317.5 // 1972-01-01
const JAN_2006_JD = 2453736.5 // where TAI − UTC steps from 32 to 33

describe('taiMinusUtc', () => {
  it('matches the table at the era boundary, a mid-table step, and today', () => {
    expect(taiMinusUtc(FIRST_LEAP_SECOND_JD - 0.5)).toBe(0)
    expect(taiMinusUtc(FIRST_LEAP_SECOND_JD)).toBe(10)
    expect(taiMinusUtc(JAN_2006_JD - 1 / SEC_PER_DAY)).toBe(32)
    expect(taiMinusUtc(JAN_2006_JD)).toBe(33)
    expect(taiMinusUtc(2457754.5)).toBe(37) // 2017-01-01, the current value
  })

  it('never decreases as time moves forward', () => {
    let previous = -1
    for (let jd = 2440000.5; jd < 2460000.5; jd += 30) {
      const value = taiMinusUtc(jd)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('jdUtcToTt', () => {
  // The offset comes back through a subtraction of two Julian Dates near 2.45e6,
  // so f64 cancellation leaves it good to ~1e-4 s — far below the model's own
  // arcsecond-scale accuracy, but not to the picosecond a bare toBeCloseTo wants.
  const TOLERANCE_S = 1e-3
  const offsetSeconds = (jdUtc: number): number => (jdUtcToTt(jdUtc) - jdUtc) * SEC_PER_DAY

  it('is 32.184 s plus the leap-second count inside the modern era', () => {
    const leapSecondsIn2017 = 37
    expect(Math.abs(offsetSeconds(utc(2017, 6, 1)) - (32.184 + leapSecondsIn2017))).toBeLessThan(TOLERANCE_S)
  })

  it('falls back to the delta-T polynomials before 1972', () => {
    const jdUtc = utc(1900, 1, 1)
    const expected = deltaTSeconds(jdToYearFraction(jdUtc))
    expect(Math.abs(offsetSeconds(jdUtc) - expected)).toBeLessThan(TOLERANCE_S)
  })
})

describe('deltaTSeconds', () => {
  it('is continuous across every piecewise boundary', () => {
    for (const year of [500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 2005, 2050]) {
      const jump = Math.abs(deltaTSeconds(year + 1e-6) - deltaTSeconds(year - 1e-6))
      expect(jump, `discontinuity at ${year}`).toBeLessThan(0.5)
    }
  })
})

describe('calendar round trips', () => {
  const fields = (jd: number): [number, number, number, number, number, number] => {
    const c = jdToCalendar(jd)
    return [c.year, c.month, c.day, c.hour, c.minute, c.second]
  }

  it('survives the 2024 total eclipse', () => {
    expect(fields(utc(2024, 4, 8, 18, 17, 16))).toEqual([2024, 4, 8, 18, 17, 16])
  })

  it('survives the Gregorian changeover', () => {
    expect(fields(utc(1582, 10, 15, 0, 0, 0))).toEqual([1582, 10, 15, 0, 0, 0])
  })

  it('survives a date in 44 BCE', () => {
    expect(fields(utc(-44, 3, 15, 6, 30, 0))).toEqual([-44, 3, 15, 6, 30, 0])
  })

  it('puts J2000.0 at its documented Julian Date', () => {
    expect(utc(2000, 1, 1, 12)).toBeCloseTo(J2000, 9)
  })

  it('never renders a sixtieth second when rounding carries up', () => {
    expect(formatUtc(utc(2024, 1, 1, 0, 0, 59) + 0.999 / SEC_PER_DAY)).not.toContain(':60')
  })
})

describe('formatUtc', () => {
  it('pads every field and marks a BCE year with a leading minus', () => {
    expect(formatUtc(utc(-44, 3, 15, 6, 5, 4))).toBe('-0044-03-15 06:05:04')
  })
})

describe('parseUtc', () => {
  it('reads a space-separated timestamp, the ISO T-and-Z form, and a bare date', () => {
    const instant = utc(2024, 4, 8, 18, 17, 16)
    expect(parseUtc('2024-04-08 18:17:16')).toBeCloseTo(instant, 9)
    expect(parseUtc('2024-04-08T18:17:16Z')).toBeCloseTo(instant, 9)
    expect(parseUtc('2024-04-08')).toBeCloseTo(utc(2024, 4, 8), 9)
  })

  it('returns null rather than throwing on malformed input', () => {
    for (const bad of ['', 'not a date', '2024-13-01', '2024-01-32', '2024-01-01 25:00', '2024/01/01']) {
      expect(parseUtc(bad), bad).toBeNull()
    }
  })

  it('round-trips through formatUtc to within its one-second truncation', () => {
    const jd = 2460409.2619
    const reparsed = parseUtc(formatUtc(jd))
    expect(reparsed).not.toBeNull()
    expect(Math.abs((reparsed as number) - jd) * SEC_PER_DAY).toBeLessThan(1)
  })
})
