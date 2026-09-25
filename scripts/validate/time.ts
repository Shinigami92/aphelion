/** Time scales and Kepler's equation. */

import { calendarToJd, formatUtc, jdToCalendar, parseUtc } from '../../src/astro/calendar.ts';
import { solveEccentricAnomaly, wrap2pi } from '../../src/astro/kepler.ts';
import { jdUtcToTt, taiMinusUtc } from '../../src/astro/timescales.ts';
import { near, ok, section } from './harness.ts';

export function checkTimeScales(): void {
  section('Time scales');

  near(
    'J2000 epoch JD',
    calendarToJd({ year: 2000, month: 1, day: 1, hour: 12, minute: 0, second: 0, ms: 0 }),
    2451545.0,
    1e-9,
  );
  near(
    'Unix epoch JD',
    calendarToJd({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 }),
    2440587.5,
    1e-9,
  );
  near(
    'leap seconds 2026',
    taiMinusUtc(
      calendarToJd({ year: 2026, month: 8, day: 6, hour: 0, minute: 0, second: 0, ms: 0 }),
    ),
    37,
    0,
  );
  // Tolerance is set by the f64 round-off of differencing two ~2.46e6 Julian
  // Dates and scaling by 86400, not by the accuracy of the leap-second table.
  near('TT-UTC 2026 (seconds)', (jdUtcToTt(2461000.5) - 2461000.5) * 86400, 69.184, 1e-4);

  {
    // Round-trip a spread of dates through the calendar conversions.
    const dates = [
      { year: 1600, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
      { year: 1899, month: 12, day: 31, hour: 23, minute: 59, second: 59, ms: 0 },
      { year: 2026, month: 8, day: 6, hour: 14, minute: 32, second: 7, ms: 0 },
      // 2500 is a century year not divisible by 400, so February has 28 days.
      { year: 2500, month: 2, day: 28, hour: 6, minute: 0, second: 0, ms: 0 },
      { year: 2400, month: 2, day: 29, hour: 6, minute: 0, second: 0, ms: 0 },
    ];
    let allOk = true;
    for (const d of dates) {
      const back = jdToCalendar(calendarToJd(d));
      if (
        back.year !== d.year ||
        back.month !== d.month ||
        back.day !== d.day ||
        back.hour !== d.hour ||
        back.minute !== d.minute ||
        Math.abs(back.second - d.second) > 1
      ) {
        allOk = false;
        console.log(`      mismatch: ${JSON.stringify(d)} -> ${JSON.stringify(back)}`);
      }
    }
    ok('calendar round-trip', allOk);
  }

  ok('parseUtc round-trip', formatUtc(parseUtc('2026-08-06 14:32:07')!) === '2026-08-06 14:32:07');
  ok('parseUtc rejects garbage', parseUtc('not a date') === null);
  ok('parseUtc rejects month 13', parseUtc('2026-13-01') === null);
}

export function checkKepler(): void {
  section("Kepler's equation");

  {
    let worst = 0;
    for (const e of [0, 0.01, 0.2, 0.5, 0.8, 0.9, 0.95, 0.99]) {
      for (let k = 0; k < 64; k++) {
        const M = (k / 64) * 2 * Math.PI;
        const E = solveEccentricAnomaly(M, e);
        // Residual of Kepler's equation itself.
        const residual = Math.abs(wrap2pi(E - e * Math.sin(E)) - wrap2pi(M));
        worst = Math.max(worst, Math.min(residual, Math.abs(residual - 2 * Math.PI)));
      }
    }
    ok(
      'Kepler residual < 1e-9 rad for e up to 0.99',
      worst < 1e-9,
      `worst ${worst.toExponential(2)}`,
    );
  }
}
