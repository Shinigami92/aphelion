/** Display tables for bodies the catalogues describe only by their orbits. */

/** Diameter from absolute magnitude and albedo — the standard relation. */
export function diameterFromMagnitude(h: number, albedo: number): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -0.2 * h);
}

/** Typical albedo per dynamical family. */
export const GROUP_ALBEDO: Record<string, number> = {
  'near-earth': 0.15,
  'inner-belt': 0.15,
  'mid-belt': 0.09,
  'outer-belt': 0.06,
  cybele: 0.05,
  hilda: 0.05,
  'jupiter-trojan': 0.05,
  centaur: 0.08,
  plutino: 0.11,
  'classical-kbo': 0.12,
  scattered: 0.09,
  detached: 0.12,
};

export const GROUP_COLOR: Record<string, number> = {
  'near-earth': 0xa89880,
  'inner-belt': 0xa89880,
  'mid-belt': 0x9a8e78,
  'outer-belt': 0x8a7d68,
  cybele: 0x8a7058,
  hilda: 0x9a7758,
  'jupiter-trojan': 0x8a6f58,
  centaur: 0x9a8478,
  plutino: 0xa08c90,
  'classical-kbo': 0x93a0b0,
  scattered: 0x8695a5,
  detached: 0x93a2b8,
};

export const GROUP_LABEL: Record<string, string> = {
  'near-earth': 'near-Earth asteroid',
  'inner-belt': 'inner main belt',
  'mid-belt': 'middle main belt',
  'outer-belt': 'outer main belt',
  cybele: 'Cybele group',
  hilda: 'Hilda group',
  'jupiter-trojan': 'Jupiter Trojan',
  centaur: 'Centaur',
  plutino: 'plutino (3:2 with Neptune)',
  'classical-kbo': 'classical Kuiper belt',
  scattered: 'scattered disc',
  detached: 'detached object',
};

/** Roman numeral designations, for satellite subtitles. */
const ROMAN = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
];

export function romanFor(code: number): string {
  // NAIF satellite codes are <planet><index>, e.g. 501 = Jupiter I.
  const index = code % 100;
  return index > 0 && index < ROMAN.length ? ROMAN[index] : String(index);
}

/**
 * What is actually parked at, or trapped in, each point.
 *
 * Keyed `<planet>:<id>`. Only the entries with something real to say are
 * listed; the rest fall back to the generic description the info panel builds
 * from the geometry.
 */
export const LAGRANGE_NOTES: Record<string, string> = {
  'earth:L1':
    'SOHO and DSCOVR hold halo orbits here, on the sunward side, where the Sun is never eclipsed and the solar wind arrives 15 to 60 minutes before it reaches Earth.',
  'earth:L2':
    'The James Webb Space Telescope, Gaia and Euclid orbit here. Earth, Moon and Sun stay in the same half of the sky, so one shield covers all three and the far side is permanently cold and dark.',
  'earth:L3':
    'Permanently hidden behind the Sun from Earth, which made it a favourite home for a fictional "Counter-Earth". Nothing is there: perturbations from Venus alone would clear the point in about 150 years.',
  'earth:L4':
    'Holds 2010 TK7, the first Earth Trojan found, and 2020 XL5. Both librate in wide, tilted arcs rather than sitting at the point.',
  'earth:L5':
    'No Earth Trojan has ever been confirmed here — Hayabusa2 photographed the point on its way out in 2017 and found nothing. Both known Earth Trojans are at L4. (The Kordylewski dust clouds are a different pair of points, of the Earth–Moon system, which Aphelion does not model.)',
  'mars:L4':
    'Home to a small, stable Trojan family — 1999 UJ7 is the only one at L4, against several at L5.',
  'mars:L5':
    'Holds 5261 Eureka and its relatives, a genuine collisional family that has probably been here since Mars formed.',
  'jupiter:L4':
    'The Greek camp: tens of thousands of catalogued Trojans, led by 588 Achilles. Aphelion draws about 4,200 of them as part of the belt swarm.',
  'jupiter:L5':
    'The Trojan camp, led by 617 Patroclus. Slightly less populous than the Greeks, for reasons still argued over.',
  'neptune:L4':
    'The largest known Trojan population after Jupiter’s, and probably larger still — they are simply very faint at 30 AU.',
  'neptune:L5':
    'Holds several known Trojans, including 2008 LC18, found in a deliberate search through a gap in the Galactic plane.',
};

/**
 * Nominal size of a Lagrange-point marker, as a fraction of the Hill radius.
 *
 * A Lagrange point has no size, but the camera frames what it focuses in radii
 * of it, so it needs a viewing scale — and that scale has to grow with the
 * system, or Neptune's points would be framed like Mercury's. A twentieth of
 * the Hill radius puts the default 4.2-radii arrival at about a fifth of the
 * way to the planet, close enough to read the marker with the planet still a
 * visible disc behind it. It also sets how close you may zoom: 1.02 of it.
 */
export const MARKER_HILL_FRACTION = 20;
