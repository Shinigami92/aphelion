/**
 * Sanity checks for the astronomy core.
 *
 * Run with: pnpm validate
 *
 * These are invariants and known reference values, not a full ephemeris
 * comparison — the point is to catch sign errors, unit slips and frame mixups,
 * which is exactly the class of bug that silently produces a plausible-looking
 * but wrong solar system.
 *
 * Each section is a function in scripts/validate/, run here in order.
 */

import { checkTidalLocking } from './validate/frames.ts';
import { report } from './validate/harness.ts';
import { checkSharedLinks } from './validate/links.ts';
import {
  checkFloat32Orbits,
  checkLagrangePoints,
  checkRenderableOrbits,
} from './validate/orbits.ts';
import {
  checkInclinations,
  checkLunarTheory,
  checkOrbitalPeriods,
  checkPlanetaryPositions,
} from './validate/planets.ts';
import { checkReliefGrids } from './validate/relief-grids.ts';
import { checkShapeModels } from './validate/relief-shapes.ts';
import { checkRingRemap, checkRingStructure } from './validate/rings.ts';
import { checkStarCatalogue } from './validate/stars.ts';
import { checkKepler, checkTimeScales } from './validate/time.ts';
import { checkUranianMosaics, checkUranianSystem } from './validate/uranus.ts';

checkTimeScales();
checkKepler();
checkPlanetaryPositions();
checkLunarTheory();
checkOrbitalPeriods();
checkInclinations();
checkSharedLinks();
checkRingRemap();
checkRingStructure();
checkRenderableOrbits();
checkLagrangePoints();
checkFloat32Orbits();
checkTidalLocking();
checkReliefGrids();
checkShapeModels();
checkStarCatalogue();
checkUranianSystem();
checkUranianMosaics();

report();
