/** The reference instant most checks are evaluated at, and a scratch vector. */

import { calendarToJd } from '../../src/astro/calendar.ts';
import { jdUtcToTt } from '../../src/astro/timescales.ts';

export const jdUtc = calendarToJd({
  year: 2026,
  month: 8,
  day: 6,
  hour: 0,
  minute: 0,
  second: 0,
  ms: 0,
});
export const jdTT = jdUtcToTt(jdUtc);

export const v = { x: 0, y: 0, z: 0 };
