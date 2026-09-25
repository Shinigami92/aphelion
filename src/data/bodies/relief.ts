/** How much each body's published relief is exaggerated at explore scale. */

/**
 * Vertical exaggeration applied to relief in *explore* scale. True scale always
 * renders relief 1:1.
 *
 * Mars's whole elevation range is 29 km on a 3,390 km radius — under one percent,
 * and invisible on a disc a few hundred pixels across. That is an honest thing to
 * show in true scale and a dull one in explore scale, which already trades metric
 * fidelity for legibility by enlarging every body sixfold. Exaggerating relief
 * there is the same bargain, so the number is chosen to read well rather than to
 * mean anything: 12x puts Olympus Mons about 7% of a Martian radius tall.
 *
 * Anything not listed renders relief unexaggerated. The info panel always states
 * the factor in use, because exaggerated terrain that does not say so is exactly
 * the kind of plausible-looking wrongness this project tries to avoid.
 */
export const RELIEF_EXAGGERATION: Record<string, number> = {
  mars: 12,
  // The Moon's range is proportionally larger than Mars's (1.1% of radius
  // against 0.86%) and its terrain is far busier, so it needs less help.
  'moon:Moon': 8,
  // Earth is the flattest of the three by a wide margin — 6.4 km of land relief
  // on a 6,378 km radius, a tenth of one percent — so it needs the most. Kept
  // below the atmosphere shell, and the cloud deck lifts to clear the peaks.
  earth: 25,
  // Flatter still, and the flattest thing in the app: 2.1 km of range on a
  // 2,575 km radius, eight hundredths of a percent. Titan is a world of dune
  // seas and shallow methane basins, with no mountain range above about 3 km
  // anywhere on it. 30x puts that range at the same fraction of a radius as
  // Earth's 25x does, which is where it stops reading as a smooth ball.
  'moon:Titan': 30,
};
