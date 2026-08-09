/**
 * Scale models.
 *
 * The solar system is mostly vacuum: at true scale, if Earth is one pixel then
 * the Sun is 108 pixels away and Neptune is 3,200. You cannot see an orbit and
 * a planet at the same time. So Aphelion offers two models, and — importantly —
 * **both preserve every angle and direction exactly**. Only radial distances and
 * body radii are remapped, so what you see is never geometrically wrong about
 * where anything is, just about how far away it is.
 *
 *   true    — 1:1. Metrically honest, and genuinely humbling.
 *   explore — bodies enlarged by a constant factor (so relative sizes stay
 *             true), heliocentric distances compressed by a power law, and
 *             satellite distances compressed in units of the parent's radius so
 *             each moon system stays visible around its enlarged planet.
 *
 * The power laws are monotone, so ordering is never violated: if A is further
 * from the Sun than B, it still is after remapping.
 */

import { AU_KM, SCENE_UNIT_KM } from './constants.ts'

export type ScaleMode = 'true' | 'explore'

export interface ScaleParams {
  /** Uniform multiplier on every body radius in explore mode. */
  bodyScale: number
  /** Exponent for heliocentric distance compression (1 = no compression). */
  heliocentricExponent: number
  /** Exponent for satellite distance compression, in parent radii. */
  satelliteExponent: number
  /** Parent radii below which satellite distances are left proportional. */
  satelliteKnee: number
}

export const DEFAULT_PARAMS: ScaleParams = {
  bodyScale: 6,
  heliocentricExponent: 0.6,
  satelliteExponent: 0.62,
  satelliteKnee: 3,
}

/**
 * Below the knee the satellite remap is the identity: distances within a few
 * radii of a planet are already legible and compressing them only does damage.
 *
 * That inner region is where the rings live — Saturn's span 1.24 to 2.33 radii
 * — and where their shepherd moons live with them. Compressing it drew Saturn's
 * rings at 72% of their true proportion, which is visibly not the silhouette
 * everyone knows. Compression exists to rein in the far irregulars: Phoebe at
 * 215 radii, not Pan at 2.2.
 *
 * So the law is piecewise: proportional near the planet, a power law beyond.
 * It stays monotone, which is the property the whole scale model rests on, and
 * it is continuous at the knee; only the slope steps, which nothing can see.
 */
function shapeSatellite(inParentRadii: number, exponent: number, knee: number): number {
  if (inParentRadii <= knee) return inParentRadii
  return knee * Math.pow(inParentRadii / knee, exponent)
}

export class ScaleModel {
  mode: ScaleMode = 'explore'
  params: ScaleParams = { ...DEFAULT_PARAMS }

  /** Interpolation weight, 0 = true, 1 = explore. Animated on mode changes. */
  private blend = 1

  /** Where the blend is heading. */
  private target = 1

  get isExplore(): boolean {
    return this.target === 1
  }

  get blendAmount(): number {
    return this.blend
  }

  /** True while a scale transition is still animating. */
  get isTransitioning(): boolean {
    return Math.abs(this.blend - this.target) > 1e-4
  }

  setMode(mode: ScaleMode): void {
    this.mode = mode
    this.target = mode === 'explore' ? 1 : 0
  }

  toggle(): ScaleMode {
    this.setMode(this.mode === 'explore' ? 'true' : 'explore')
    return this.mode
  }

  /** Ease the blend toward its target. Call once per frame. */
  update(dtSeconds: number): void {
    if (!this.isTransitioning) {
      this.blend = this.target
      return
    }
    // Exponential approach, ~0.6 s to settle.
    const k = 1 - Math.exp(-dtSeconds / 0.18)
    this.blend += (this.target - this.blend) * k
  }

  /** Snap to the target with no animation (used during setup). */
  snap(): void {
    this.blend = this.target
  }

  // -- radii ---------------------------------------------------------------

  /** Render radius for a body, in scene units. */
  bodyRadius(radiusKm: number): number {
    const scaled = radiusKm * this.params.bodyScale
    return this.lerp(radiusKm, scaled) / SCENE_UNIT_KM
  }

  /** The same multiplier, unitless — handy for ring and atmosphere shells. */
  get radiusMultiplier(): number {
    return this.lerp(1, this.params.bodyScale)
  }

  /**
   * Vertical exaggeration for surface relief: true relief at true scale, the
   * body's own factor at explore scale, blended across the transition so terrain
   * grows with the body rather than popping.
   *
   * Explore mode already trades metric fidelity for legibility by enlarging
   * every body sixfold; exaggerating relief there is the same bargain, and the
   * info panel names the factor so it is never mistaken for real geometry.
   */
  reliefExaggeration(atExplore: number): number {
    return this.lerp(1, atExplore)
  }

  // -- distances -----------------------------------------------------------

  /**
   * Remap a heliocentric distance (km) to scene units.
   *
   * Normalised at 1 AU so Earth's orbit is the same size in both modes, which
   * keeps the transition from feeling like an arbitrary zoom.
   */
  heliocentricDistance(km: number): number {
    const compressed = AU_KM * Math.pow(Math.max(km, 1) / AU_KM, this.params.heliocentricExponent)
    return this.lerp(km, compressed) / SCENE_UNIT_KM
  }

  /**
   * Remap a satellite's distance from its parent (km) to scene units.
   *
   * Expressed in parent radii and shaped there, then re-expanded against the
   * parent's *rendered* radius. The upshot: the innermost moons always clear
   * the enlarged planet's limb, and the far irregulars stay on screen instead
   * of being flung a hundred times too far out.
   *
   * Ring radii go through this same function, because a ring is a population of
   * orbiting bodies and has to be remapped as one. Anything else parts the
   * shepherds from their gaps — see `GLSL_RING_SCALE_PARS` in render/materials.
   */
  satelliteDistance(km: number, parentRadiusKm: number): number {
    const inParentRadii = Math.max(km, 1) / parentRadiusKm
    const shaped = shapeSatellite(
      inParentRadii,
      this.params.satelliteExponent,
      this.params.satelliteKnee,
    )
    const compressed = parentRadiusKm * this.params.bodyScale * shaped
    return this.lerp(km, compressed) / SCENE_UNIT_KM
  }

  /**
   * Scale factor to apply to a heliocentric position vector, so callers can
   * remap a direction-preserving position without recomputing its length.
   */
  heliocentricFactor(km: number): number {
    if (km < 1) return this.heliocentricDistance(1) / (1 / SCENE_UNIT_KM)
    return (this.heliocentricDistance(km) * SCENE_UNIT_KM) / km
  }

  /** Same, for a satellite position vector. */
  satelliteFactor(km: number, parentRadiusKm: number): number {
    if (km < 1) return 1
    return (this.satelliteDistance(km, parentRadiusKm) * SCENE_UNIT_KM) / km
  }

  private lerp(atTrue: number, atExplore: number): number {
    return atTrue + (atExplore - atTrue) * this.blend
  }
}
