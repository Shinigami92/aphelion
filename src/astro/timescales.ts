/**
 * Time scale conversions: UTC <-> Julian Date <-> Terrestrial Time.
 *
 * Dynamics need TT; humans read UTC. The offset between them is
 *   TT - UTC = 32.184 s + (TAI - UTC)
 * where (TAI - UTC) is the integer count of leap seconds. Before 1972 there
 * were no leap seconds, so we fall back to the Espenak & Meeus dT polynomials
 * (dT = TT - UT), which is what historical eclipse work uses.
 *
 * Calendar dates and their text form are in calendar.ts.
 */

import { JD_UNIX_EPOCH, MS_PER_DAY, SEC_PER_DAY } from '../core/constants.ts';

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
];

/** TAI - UTC in seconds for a given UTC Julian Date. */
export function taiMinusUtc(jdUTC: number): number {
  let v = 0;
  for (const entry of LEAP_SECONDS) {
    if (jdUTC >= entry[0]) {
      v = entry[1];
    } else {
      break;
    }
  }
  return v;
}

/**
 * dT = TT - UT in seconds, from the Espenak & Meeus (2006) piecewise fits used
 * by NASA's eclipse canon. Only consulted outside the leap-second era.
 */
export function deltaTSeconds(year: number): number {
  const y = year;

  if (y < 1600) {
    return deltaTBeforeTelescopes(y);
  }
  if (y < 1900) {
    return deltaTTelescopic(y);
  }
  return deltaTModern(y);
}

/** Before 1600: fits to ancient and medieval eclipse and occultation records. */
function deltaTBeforeTelescopes(y: number): number {
  if (y < -500) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (y < 500) {
    const u = y / 100;
    return (
      10583.6 +
      u *
        (-1014.41 +
          u *
            (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521)))))
    );
  }
  const u = (y - 1000) / 100;
  return (
    1574.2 +
    u *
      (-556.01 +
        u * (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073)))))
  );
}

/** 1600 to 1900: telescopic timings of occultations and transits. */
function deltaTTelescopic(y: number): number {
  if (y < 1700) {
    const t = y - 1600;
    return 120 + t * (-0.9808 + t * (-0.01532 + t / 7129));
  }
  if (y < 1800) {
    const t = y - 1700;
    return 8.83 + t * (0.1603 + t * (-0.0059285 + t * (0.00013336 - t / 1174000)));
  }
  if (y < 1860) {
    const t = y - 1800;
    return (
      13.72 +
      t *
        (-0.332447 +
          t *
            (0.0068612 +
              t *
                (0.0041116 +
                  t *
                    (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875))))))
    );
  }
  const t = y - 1860;
  return (
    7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174))))
  );
}

/** From 1900: the modern record, and its extrapolation past 2050. */
function deltaTModern(y: number): number {
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 0.000197)));
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936));
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547));
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718));
  }
  if (y < 2005) {
    const t = y - 2000;
    return (
      63.86 +
      t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))))
    );
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + t * (0.32217 + t * 0.005589);
  }
  if (y < 2150) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - y);
  }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Approximate decimal year for a Julian Date (used only for dT lookup). */
export function jdToYearFraction(jd: number): number {
  return 2000 + (jd - 2451545.0) / 365.25;
}

/** UTC Julian Date -> TT Julian Date. */
export function jdUtcToTt(jdUTC: number): number {
  const first = LEAP_SECONDS[0];
  if (first !== undefined && jdUTC >= first[0]) {
    return jdUTC + (32.184 + taiMinusUtc(jdUTC)) / SEC_PER_DAY;
  }
  return jdUTC + deltaTSeconds(jdToYearFraction(jdUTC)) / SEC_PER_DAY;
}

/** Unix epoch milliseconds (UTC) -> Julian Date. */
export function msToJd(ms: number): number {
  return JD_UNIX_EPOCH + ms / MS_PER_DAY;
}

/** Julian Date -> Unix epoch milliseconds (UTC). */
export function jdToMs(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/** Julian centuries of TT since J2000.0. */
export function centuriesSinceJ2000(jdTT: number): number {
  return (jdTT - 2451545.0) / 36525;
}

/** Days of TT since J2000.0. */
export function daysSinceJ2000(jdTT: number): number {
  return jdTT - 2451545.0;
}

/**
 * Greenwich Mean Sidereal Time in radians, IAU 1982 series.
 * Used as an independent check on the Earth rotation model.
 */
export function gmst(jdUT1: number): number {
  const d = jdUT1 - 2451545.0;
  const t = d / 36525;
  let s =
    67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  s = ((s % 86400) + 86400) % 86400;
  return (s / 240) * (Math.PI / 180); // 1 second of time = 1/240 degree
}

/** Current wall clock as a UTC Julian Date. */
export function nowJdUtc(): number {
  return msToJd(Date.now());
}
