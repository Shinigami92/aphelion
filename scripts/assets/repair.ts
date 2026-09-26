/**
 * Repairing the satellite table from the ephemerides behind it.
 *
 * JPL's mean-element page does not always describe the ephemeris it names, in
 * two independent ways.
 *
 * The phase. For SAT441, the source paper (Jacobson 2022, AJ 164:199, Table 12)
 * publishes a, e, i, the period and the two precession periods, but no node,
 * periapsis or mean anomaly. The angles on the page reproduce neither SAT441 nor
 * the SAT427 table they replaced, and put Titan 2.39 million km from its Horizons
 * position at the epoch. JUP348, JUP349, SAT456, URA117, NEP104 and Pluto's small
 * moons are the same: they land up to the far side of their orbits at the very
 * epoch the angles are quoted for.
 *
 * The rate. The page calls P the sidereal period, and for SAT441, URA182 and
 * Pluto's moons it is. For the Galileans it is the anomalistic period, and Io's
 * and Europa's periapses regress with the Laplace resonance rather than advance.
 * Elsewhere it is neither. No single reading of P and the unsigned precession
 * periods keeps every moon in place: the propagator's reading had Enceladus,
 * Dione, Ariel, Miranda, Europa, Phobos and Deimos 120–180° out within ten years.
 *
 * So each moon is compared with Horizons at its epoch and at a ladder of dates up
 * to 20 years either side. Where the table puts it more than `MAX_ERROR_DEG` from
 * the ephemeris at the epoch, the node, periapsis and mean anomaly are re-derived
 * from the Horizons state on the table's own orbit shape. The mean-longitude rate
 * is then fitted to Horizons across the whole window, and replaces the table's
 * where it at least halves the worst error there: a regular moon's rate fits to a
 * fraction of a degree in 40 years, while an irregular's osculating longitude is
 * too noisy to beat its mean one.
 *
 * The node. Triton's nodal period on the page is 340.379 years, exactly half the
 * 677.4 its ephemeris regresses at, which had it 58–97° out 40 to 60 years from
 * the epoch. So the node rate is fitted the same way, before the mean motion it
 * feeds into, and kept where it too at least halves the worst error. That gate
 * is judged inside the fitted window, so it was checked outside it: at 40 and 60
 * years either side, 54 of the 57 rows it changes land closer to Horizons, and
 * the three that do not were over 80° out already.
 *
 * Every other row keeps JPL's mean elements untouched, and the shape, the
 * apsidal precession and the plane are always JPL's.
 */

import type { Basis } from '../../src/astro/frames.ts';
import type { Phase, Vec3 } from '../../src/astro/kepler.ts';
import type { SatelliteData } from '../../src/data/generated/satellites.ts';
import type { StateVector } from './horizons.ts';
import { applyBasis } from '../../src/astro/frames.ts';
import { phaseFromState, positionAtTime, wrapPi } from '../../src/astro/kepler.ts';
import { DEG, GM, TWO_PI } from '../../src/core/constants.ts';
import { hasGm } from '../../src/core/system/body.ts';
import { elementsFromSatellite, satelliteBasis } from '../../src/core/system/elements.ts';
import { BODY_SPECS_BY_KEY } from '../../src/data/bodies.ts';
import { horizonsStates } from './horizons.ts';
import { C } from './io.ts';

/**
 * How far a mean element set may put a moon from its ephemeris.
 *
 * The regular moons of every solution that is right land within 4° at the epoch.
 * The distant irregulars are pulled so hard by the Sun that their osculating
 * longitude swings around the mean by up to ~30° (Ymir 24°, Paaliaq 28°), and
 * that is what mean elements are for. The broken solutions are 45–180° out.
 *
 * Measured, not chosen: against Horizons ten years either side of the epoch, a
 * Horizons phase beats the table's for 75 and 77 of the 85 rows beyond 30°, and
 * in 377 of 743 comparisons below it, which is no better than a coin toss.
 */
export const MAX_ERROR_DEG = 30;

const WINDOW_DAYS = 20 * 365.25;

/** A Julian Date to the microday, so the request and its cache name are stable. */
const round = (jd: number): number => Math.round(jd * 1e6) / 1e6;

/** A table row, with a note when part of it had to come from Horizons. */
export type RepairedSatellite = SatelliteData & { fromHorizons?: string };

/**
 * The epoch, then whole periods either side doubling out to 20 years, then the
 * window's ends. The doubling is what lets the longitude be unwrapped: each step
 * is short enough that the rate fitted so far cannot lose track of a turn.
 */
export function sampleDates(sat: SatelliteData): number[] {
  const out = [sat.epoch];
  for (let d = sat.period; d < WINDOW_DAYS; d *= 2) {
    out.push(round(sat.epoch - d), round(sat.epoch + d));
  }
  out.push(sat.epoch - WINDOW_DAYS, sat.epoch + WINDOW_DAYS);
  return out;
}

/** Everything one row is checked in: its plane, its GM and a way into that plane. */
interface Frame {
  basis: Basis;
  gm: number;
  /** Ecliptic into the elements' plane: the basis is orthonormal, so transposed. */
  toPlane: (v: Vec3) => Vec3;
}

function frameOf(sat: SatelliteData): Frame {
  // The page capitalises the planet; the generated module and the body specs don't.
  const planet = sat.planet.toLowerCase();
  const basis = satelliteBasis(sat, BODY_SPECS_BY_KEY.get(planet)?.spin ?? null);
  return {
    basis,
    gm: (hasGm(planet) ? GM[planet] : 0) + (sat.gm ?? 0),
    toPlane: (v) => ({
      x: v.x * basis.x.x + v.y * basis.x.y + v.z * basis.x.z,
      y: v.x * basis.y.x + v.y * basis.y.y + v.z * basis.y.z,
      z: v.x * basis.z.x + v.y * basis.z.y + v.z * basis.z.z,
    }),
  };
}

/** Degrees between where a row puts the moon and where Horizons has it. */
function errorAt(sat: SatelliteData, frame: Frame, state: StateVector): number {
  const p = positionAtTime(elementsFromSatellite(sat), state.jd, { x: 0, y: 0, z: 0 });
  const a = applyBasis(frame.basis, p.x, p.y, p.z, { x: 0, y: 0, z: 0 });
  const b = state.r;
  const cos =
    (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

const worstError = (sat: SatelliteData, frame: Frame, states: StateVector[]): number =>
  Math.max(...states.map((s) => errorAt(sat, frame, s)));

/** Radians to degrees, at the table's precision and then some. */
const deg = (rad: number): number => Math.round((rad / DEG) * 1e4) / 1e4;

function repairPhase(sat: RepairedSatellite, frame: Frame, state: StateVector): void {
  const r = frame.toPlane(state.r);
  const v = frame.toPlane(state.v);
  const phase = phaseFromState(r, v, frame.gm, sat.e, sat.inc === 0);
  sat.node = deg(phase.node);
  sat.argPeri = deg(phase.argPeri);
  sat.m0 = deg(phase.meanAnomaly);
}

/**
 * How fast an osculating angle moves, radians per day.
 *
 * The angle is unwrapped outward from the epoch, predicting each sample from a
 * least-squares line through the ones before it, so `guess` only has to be close
 * enough not to lose a turn over the first, shortest step.
 */
function fitRate(
  sat: SatelliteData,
  states: StateVector[],
  angle: (s: StateVector) => number,
  guess: number,
): number {
  const byReach = states.toSorted(
    (a, b) => Math.abs(a.jd - sat.epoch) - Math.abs(b.jd - sat.epoch),
  );
  const a0 = angle(byReach[0]);
  const pts = [{ t: 0, l: 0 }];
  let rate = guess;
  for (const s of byReach.slice(1)) {
    const t = s.jd - sat.epoch;
    pts.push({ t, l: rate * t + wrapPi(angle(s) - a0 - rate * t) });
    const tMean = pts.reduce((acc, p) => acc + p.t, 0) / pts.length;
    const lMean = pts.reduce((acc, p) => acc + p.l, 0) / pts.length;
    const num = pts.reduce((acc, p) => acc + (p.t - tMean) * (p.l - lMean), 0);
    const den = pts.reduce((acc, p) => acc + (p.t - tMean) ** 2, 0);
    rate = num / den;
  }
  return rate;
}

const phaseIn = (sat: SatelliteData, frame: Frame, s: StateVector): Phase =>
  phaseFromState(frame.toPlane(s.r), frame.toPlane(s.v), frame.gm, null, sat.inc === 0);

/**
 * The mean-anomaly rate, degrees per day, that gives the mean longitude Horizons'
 * rate once the table's precession is added back on.
 *
 * The first guess is 2π/P, P being the sidereal period JPL's page says it is.
 * Where it is not, it is still within a degree a day, which is all the first
 * period-long step needs; the propagator's own rate is not, since Tethys's
 * tabulated apsidal period of 0.005 years adds 197° a day to it.
 */
function fitMeanMotion(sat: SatelliteData, frame: Frame, states: StateVector[]): number {
  const el = elementsFromSatellite(sat);
  const precession = (el.argPeriDot ?? 0) + (el.nodeDot ?? 0);
  const rate = fitRate(
    sat,
    states,
    (s) => {
      const p = phaseIn(sat, frame, s);
      return p.node + p.argPeri + p.meanAnomaly;
    },
    TWO_PI / sat.period,
  );
  return Math.round(((rate - precession) / DEG) * 1e6) / 1e6;
}

/**
 * The nodal precession period, years, that Horizons' node moves at, or null
 * where there is none to fit or the fit runs the wrong way.
 *
 * Only the period is replaced, like the table's own unsigned one: the direction
 * is the physics' (see `elementsFromSatellite`), and a fit that disagrees with it
 * is noise, not a measurement.
 */
function fitNodePeriod(sat: SatelliteData, frame: Frame, states: StateVector[]): number | null {
  const tabulated = elementsFromSatellite(sat).nodeDot ?? 0;
  if (sat.inc === 0 || tabulated === 0) {
    return null;
  }
  const rate = fitRate(sat, states, (s) => phaseIn(sat, frame, s).node, tabulated);
  if (Math.sign(rate) !== Math.sign(tabulated)) {
    return null;
  }
  return Math.round((TWO_PI / Math.abs(rate) / 365.25) * 1e3) / 1e3;
}

/**
 * The worst error once the rate is refitted as well. A node rate moves the mean
 * longitude too, so judging a new one on the old rate would hold it to a
 * longitude the fitted rate is about to correct anyway.
 */
function errorWithRate(sat: SatelliteData, frame: Frame, states: StateVector[]): number {
  const refitted = { ...sat, meanMotion: fitMeanMotion(sat, frame, states) };
  return Math.min(worstError(sat, frame, states), worstError(refitted, frame, states));
}

type Outcome = 'kept' | 'repaired' | 'unchecked';

async function repair(sat: RepairedSatellite): Promise<Outcome> {
  const states = await horizonsStates(sat.code, sat.planet.toLowerCase(), sampleDates(sat));
  if (!states) {
    return 'unchecked';
  }
  const frame = frameOf(sat);
  const notes: string[] = [];
  // Horizons answers in time order, not in the order the dates were asked for.
  const atEpoch = states.reduce((best, s) =>
    Math.abs(s.jd - sat.epoch) < Math.abs(best.jd - sat.epoch) ? s : best,
  );

  const phaseError = errorAt(sat, frame, atEpoch);
  if (phaseError > MAX_ERROR_DEG) {
    repairPhase(sat, frame, atEpoch);
    notes.push(`phase ${phaseError.toFixed(0)}° out`);
  }
  const nodePeriod = fitNodePeriod(sat, frame, states);
  if (nodePeriod !== null) {
    const before = errorWithRate(sat, frame, states);
    const after = errorWithRate({ ...sat, nodePeriod }, frame, states);
    if (after < before / 2) {
      notes.push(`node period ${sat.nodePeriod} → ${nodePeriod} yr`);
      sat.nodePeriod = nodePeriod;
    }
  }
  const drift = worstError(sat, frame, states);
  const fitted = { ...sat, meanMotion: fitMeanMotion(sat, frame, states) };
  const after = worstError(fitted, frame, states);
  if (after < drift / 2) {
    sat.meanMotion = fitted.meanMotion;
    notes.push(`rate ${drift.toFixed(1)}° → ${after.toFixed(1)}° in 20 yr`);
  }
  if (notes.length === 0) {
    return 'kept';
  }
  sat.fromHorizons = `Horizons: ${notes.join(', ')}`;
  return 'repaired';
}

export async function repairFromHorizons(records: RepairedSatellite[]): Promise<void> {
  const tally: Record<Outcome, number> = { kept: 0, repaired: 0, unchecked: 0 };
  for (const sat of records) {
    // Earth's Moon is placed by the lunar theory, never by this row.
    if (sat.code === 301) {
      continue;
    }
    tally[await repair(sat)]++;
  }
  console.log(
    `  ${C.green('checked')} ${tally.repaired} repaired from Horizons ${C.dim(
      `(${tally.kept} kept, ${tally.unchecked} not in Horizons)`,
    )}`,
  );
}
