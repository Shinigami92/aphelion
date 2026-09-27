/**
 * Calendar dates and their text form, in UTC only: no locale surprises and no
 * Date parsing quirks.
 */

import { MS_PER_DAY } from '../core/constants.ts';

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

const p2 = (n: number): string => String(Math.abs(n)).padStart(2, '0');
const p3 = (n: number): string => String(Math.abs(n)).padStart(3, '0');

/**
 * Julian Date -> proleptic Gregorian UTC calendar fields, via the standard
 * Meeus inverse. Stays exact for dates far outside the range JavaScript's
 * Date handles comfortably.
 */
export function jdToCalendar(jd: number): CalendarDate {
  let z = Math.floor(jd + 0.5);
  // Round the time of day to whole milliseconds before splitting it, and let a
  // round-up carry into the date. Rounding the milliseconds last, as the fields
  // fall out, carried no further than the hour: an instant a few microseconds
  // before midnight came out as 24:00:00, which parseUtc rightly refuses, so a
  // URL written at that moment dropped its time on reload.
  let msOfDay = Math.round((jd + 0.5 - z) * MS_PER_DAY);
  if (msOfDay >= MS_PER_DAY) {
    msOfDay -= MS_PER_DAY;
    z += 1;
  }

  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);

  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;

  // Integer arithmetic from here on, so no field can round up to its limit.
  const hour = Math.floor(msOfDay / 3_600_000);
  const minute = Math.floor(msOfDay / 60_000) % 60;
  const second = Math.floor(msOfDay / 1000) % 60;
  const ms = msOfDay % 1000;

  return { year, month, day, hour, minute, second, ms };
}

/** Proleptic Gregorian UTC calendar fields -> Julian Date. */
export function calendarToJd(c: CalendarDate): number {
  let y = c.year;
  let m = c.month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  // Gregorian calendar correction applies from 1582-10-15 onward.
  const gregorian =
    c.year > 1582 || (c.year === 1582 && (c.month > 10 || (c.month === 10 && c.day >= 15)));
  const A = Math.floor(y / 100);
  const B = gregorian ? 2 - A + Math.floor(A / 4) : 0;

  const dayFrac = c.day + (c.hour + (c.minute + (c.second + c.ms / 1000) / 60) / 60) / 24;

  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + B - 1524.5;
}

/** `YYYY-MM-DD HH:MM:SS` (UTC), with a leading `-` for BCE years. */
export function formatUtc(jd: number, withMs = false): string {
  const c = jdToCalendar(jd);
  const yr = (c.year < 0 ? '-' : '') + String(Math.abs(c.year)).padStart(4, '0');
  const base = `${yr}-${p2(c.month)}-${p2(c.day)} ${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`;
  return withMs ? `${base}.${p3(c.ms)}` : base;
}

export function formatUtcDate(jd: number): string {
  const c = jdToCalendar(jd);
  const yr = (c.year < 0 ? '-' : '') + String(Math.abs(c.year)).padStart(4, '0');
  return `${yr}-${p2(c.month)}-${p2(c.day)}`;
}

export function formatUtcTime(jd: number): string {
  const c = jdToCalendar(jd);
  return `${p2(c.hour)}:${p2(c.minute)}:${p2(c.second)}`;
}

/**
 * Whether a year, month and day name a date the calendar actually has. Going
 * to a Julian Date and back is the check, because it applies exactly the
 * rules the conversion does: 31 February becomes 3 March and fails, and so
 * do the ten days the Gregorian reform skipped in October 1582.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  const back = jdToCalendar(
    calendarToJd({ year, month, day, hour: 0, minute: 0, second: 0, ms: 0 }),
  );
  return back.year === year && back.month === month && back.day === day;
}

/**
 * Parse `YYYY-MM-DD[ T]HH:MM[:SS][Z]` as UTC. Returns null when unparseable so
 * callers can reject input without throwing.
 */
export function parseUtc(text: string): number | null {
  const m =
    /^\s*(-?\d{1,6})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?)?\s*Z?\s*$/iu.exec(
      text,
    );
  if (!m) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const secFloat = m[6] ? Number(m[6]) : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    secFloat >= 61 ||
    !isRealDate(year, month, day)
  ) {
    return null;
  }
  const second = Math.floor(secFloat);
  return calendarToJd({
    year,
    month,
    day,
    hour,
    minute,
    second,
    ms: Math.round((secFloat - second) * 1000),
  });
}
