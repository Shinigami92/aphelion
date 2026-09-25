/** The shape of a catalogued body: physical properties, rotation, rings, atmosphere and facts. */

import type { SpinModel } from '../astro/frames.ts';

/**
 * `lagrange` is the one member that is not an object: it marks the massless
 * equilibrium points of a Sun-planet pair, which are simulated and focusable
 * but have no mass, no surface and no orbit of their own. See core/system.ts.
 */
export type BodyType = 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid' | 'lagrange';

/**
 * Single-scattering atmosphere parameters.
 *
 * `density` is the one number here that means something outside this file: it is
 * the atmosphere's **vertical optical depth**, in the channel the `rayleigh`
 * tint peaks in. The shader measures every path length in scale heights, so the
 * figure is dimensionless and identical at true and explore scale, and it can be
 * checked against published values rather than dialled in by eye. Earth's 0.23
 * is its Rayleigh optical depth at 440 nm, and the `rayleigh` triple below it is
 * very nearly the lambda^-4 ratio between 650, 550 and 440 nm.
 *
 * The rest are appearance: `rayleigh` is a scattering *tint*, not a
 * cross-section, which is how Titan's orange and Uranus' cyan get expressed at
 * all — both are absorption features (tholins, methane) rather than Rayleigh
 * colour, and folding them in here beats a second set of absorption uniforms.
 *
 * One caveat worth knowing before retuning any of these. The shell is additive
 * over the body's own texture, and for every body except Earth and Mars that
 * texture *is* a photograph of the atmosphere — Jupiter's bands, Venus' deck,
 * Uranus' cyan — so it already contains the scattering below the cloud tops.
 * The shell therefore stands for the haze *above* the mapped deck, and the
 * figures below are column depths to roughly the 1 bar level rather than to the
 * bottom of the atmosphere. Earth is the exception: its map is land and ocean,
 * so it gets the whole column.
 */
export interface AtmosphereSpec {
  /** Scale height of the visible haze, km — the shell is five of them. */
  thicknessKm: number;
  /** Rayleigh scattering tint (relative RGB, not physical units). */
  rayleigh: [number, number, number];
  /** Mie (aerosol) strength, relative to the Rayleigh tint. */
  mie: number;
  /** Vertical optical depth of the haze — see above; not a free multiplier. */
  density: number;
  /** Ground-level haze colour, used for the terminator glow. */
  groundTint: [number, number, number];
}

/**
 * One radial band of a ring system, at its published boundaries.
 *
 * `tau` is the normal optical depth — the physical quantity occultations
 * actually measure — so opacity comes out as `1 - exp(-tau)` rather than being
 * dialled in by eye. That is what makes the B ring read as dense, the Cassini
 * Division as a real dark lane rather than a painted stripe, and the Uranian
 * rings as the near-invisible threads they are.
 *
 * A band with `tau: 0` is a gap. Gaps are listed explicitly rather than left as
 * holes because the whole point is that a named gap sits where a named moon put
 * it, and `pnpm validate` checks exactly that.
 */
export interface RingBand {
  name: string;
  innerKm: number;
  outerKm: number;
  /** Normal optical depth. 0 for a gap. */
  tau: number;
  /** sRGB colour of the particles in this band. */
  color: number;
  /** What clears or confines this band, when something does. */
  cause?: string;
}

export interface RingSpec {
  name: string;
  innerKm: number;
  outerKm: number;
  /** Texture file in public/textures; procedural when absent. */
  texture?: string;
  /** Peak opacity. */
  opacity: number;
  /** Optional description for the info panel. */
  note?: string;
  /**
   * Radial structure. When present the profile is generated from these bands
   * instead of from noise, so every edge lands at a real kilometre.
   */
  bands?: RingBand[];
  /**
   * Brightness multiplier applied in explore scale only, 1 by default.
   *
   * The honest render of Uranus's rings is nothing at all: charcoal at 3%
   * albedo, a few kilometres wide across a 9,700 km span, so they average out
   * below one pixel long before you are close enough to see them. Every
   * published image of them is contrast-stretched for exactly this reason.
   *
   * This is the same bargain relief exaggeration already makes — true scale
   * stays literal, explore scale trades a stated amount of photometric
   * fidelity for being able to see the thing at all. It changes opacity only:
   * no radius, no width, no gap moves.
   */
  exploreBoost?: number;
  /**
   * Albedo multiplier in explore scale only, 1 by default.
   *
   * Separate from `exploreBoost` because opacity and darkness are different
   * problems and want wildly different numbers. A tenuous dust ring is
   * transparent — optical depth 1e-5 — and needs its *alpha* lifted by orders
   * of magnitude. Uranus's narrow rings are the opposite: nearly opaque, and
   * simply black, charcoal decoding to about 0.037 in linear light. Boosting
   * their alpha achieves nothing, because it already saturates; what is needed
   * is a few times more light. Folding both into one number would blow one of
   * them out while barely touching the other.
   */
  exploreBrightness?: number;
}

export interface BodyFacts {
  /** kg */
  mass: number;
  /** m/s^2 at the equator */
  gravity: number;
  /** km/s */
  escapeVelocity: number;
  /** Sidereal rotation period in hours; negative is retrograde. */
  rotationHours: number;
  /** Obliquity to its orbit, degrees. */
  axialTilt: number;
  /** Mean surface or 1-bar temperature, degrees C. */
  temperatureC: number;
  /** Bond albedo. */
  albedo: number;
  composition: string;
  discovered: string;
  blurb: string;
}

export interface BodySpec {
  key: string;
  name: string;
  type: BodyType;
  /** Parent key; null for the Sun. */
  parent: string | null;
  /** Equatorial radius, km. */
  radiusKm: number;
  /** (Req - Rpol) / Req. 0 for a sphere. */
  flattening: number;
  spin: SpinModel;
  /** Base colour used by the procedural texture generator and for orbit lines. */
  color: number;
  /** Texture files, all optional — missing ones fall back to procedural. */
  textures?: {
    map?: string;
    night?: string;
    clouds?: string;
    normal?: string;
    specular?: string;
  };
  /**
   * Multiplied into the albedo map. Use only to colourise a *panchromatic*
   * source: several USGS mosaics are single-channel, and rendering Pluto in grey
   * misinforms as badly as a synthetic surface would, since its butterscotch
   * colour is the single most recognisable thing about it. Normalise so the
   * brightest channel is 1.0, or the body also loses its albedo.
   *
   * Bodies that genuinely are neutral (Charon, Phobos, Vesta) must leave this
   * unset — inventing colour for them would be the opposite of the point.
   */
  textureTint?: number;
  /**
   * Rotation of the cloud deck *relative to the crust below it*, degrees of
   * longitude per day, positive eastward — the same sense as `spin.wDot`, so
   * the shell's total rate is `spin.wDot + cloudDriftDegPerDay`.
   *
   * Leave unset unless there is a measured rate to quote. A deck pinned to the
   * ground is wrong by a few degrees a day; one drifting at an invented rate is
   * wrong by however much was invented, and looks deliberate.
   *
   * Use this only where the deck really does turn as one piece. Venus does —
   * its superrotation is near solid-body out to 50 degrees. Earth does not, and
   * uses `cloudWindMs` instead; the two are alternatives, never both.
   */
  cloudDriftDegPerDay?: number;
  /**
   * Mean zonal wind, m/s, **positive eastward**, sampled at 19 latitudes evenly
   * spaced from -90 to +90 (10 degree steps, index 0 is the south pole).
   *
   * This is the alternative to `cloudDriftDegPerDay` for a body whose deck
   * shears rather than turning as one piece. The renderer converts each sample
   * to an angular rate with `u / (R cos lat)` and then splits the result: the
   * area-weighted mean becomes a rigid drift, exactly as if it had been written
   * here as one, and only the latitude structure left over is advected through
   * the map. Set one field or the other, never both — a profile produces its
   * own mean.
   *
   * Must fall to zero at both poles: the wind is a linear speed and the angular
   * rate it implies diverges as `cos lat` vanishes.
   */
  cloudWindMs?: ReadonlyArray<number>;
  atmosphere?: AtmosphereSpec;
  rings?: RingSpec[];
  /** Emissive bodies (the Sun) skip lighting entirely. */
  emissive?: boolean;
  facts: BodyFacts;
}
