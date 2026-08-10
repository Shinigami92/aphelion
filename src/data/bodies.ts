/**
 * The Sun, the planets and the dwarf planets: physical properties, rotation
 * models, ring systems, atmospheres and the facts shown in the info panel.
 *
 * Radii are mean radii in km unless a flattening is given, in which case the
 * equatorial radius is used for rendering and the oblateness is applied as a
 * vertical squash. Rotation models are the IAU values (see astro/frames.ts).
 */

import type { SpinModel } from '../astro/frames.ts'

export type BodyType = 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid'

/** Single-scattering atmosphere parameters, tuned per body. */
export interface AtmosphereSpec {
  /** Scale height of the visible haze, km — sets the shell thickness. */
  thicknessKm: number
  /** Rayleigh scattering tint (relative RGB, not physical units). */
  rayleigh: [number, number, number]
  /** Mie (aerosol) strength. */
  mie: number
  /** Overall optical density multiplier. */
  density: number
  /** Ground-level haze colour, used for the terminator glow. */
  groundTint: [number, number, number]
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
  name: string
  innerKm: number
  outerKm: number
  /** Normal optical depth. 0 for a gap. */
  tau: number
  /** sRGB colour of the particles in this band. */
  color: number
  /** What clears or confines this band, when something does. */
  cause?: string
}

export interface RingSpec {
  name: string
  innerKm: number
  outerKm: number
  /** Texture file in public/textures; procedural when absent. */
  texture?: string
  /** Peak opacity. */
  opacity: number
  /** Optional description for the info panel. */
  note?: string
  /**
   * Radial structure. When present the profile is generated from these bands
   * instead of from noise, so every edge lands at a real kilometre.
   */
  bands?: RingBand[]
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
  exploreBoost?: number
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
  exploreBrightness?: number
}

export interface BodyFacts {
  /** kg */
  mass: number
  /** m/s^2 at the equator */
  gravity: number
  /** km/s */
  escapeVelocity: number
  /** Sidereal rotation period in hours; negative is retrograde. */
  rotationHours: number
  /** Obliquity to its orbit, degrees. */
  axialTilt: number
  /** Mean surface or 1-bar temperature, degrees C. */
  temperatureC: number
  /** Bond albedo. */
  albedo: number
  composition: string
  discovered: string
  blurb: string
}

export interface BodySpec {
  key: string
  name: string
  type: BodyType
  /** Parent key; null for the Sun. */
  parent: string | null
  /** Equatorial radius, km. */
  radiusKm: number
  /** (Req - Rpol) / Req. 0 for a sphere. */
  flattening: number
  spin: SpinModel
  /** Base colour used by the procedural texture generator and for orbit lines. */
  color: number
  /** Texture files, all optional — missing ones fall back to procedural. */
  textures?: {
    map?: string
    night?: string
    clouds?: string
    normal?: string
    specular?: string
  }
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
  textureTint?: number
  atmosphere?: AtmosphereSpec
  rings?: RingSpec[]
  /** Emissive bodies (the Sun) skip lighting entirely. */
  emissive?: boolean
  facts: BodyFacts
}

// ---------------------------------------------------------------------------
// The Sun
// ---------------------------------------------------------------------------

export const SUN: BodySpec = {
  key: 'sun',
  name: 'Sun',
  type: 'star',
  parent: null,
  radiusKm: 695_700,
  flattening: 0.000009,
  spin: { poleRa: 286.13, poleDec: 63.87, w0: 84.176, wDot: 14.1844 },
  color: 0xfff4e0,
  textures: { map: 'sun.jpg' },
  emissive: true,
  facts: {
    mass: 1.9885e30,
    gravity: 274,
    escapeVelocity: 617.7,
    rotationHours: 609.12,
    axialTilt: 7.25,
    temperatureC: 5505,
    albedo: 0,
    composition: 'Hydrogen 73%, helium 25%, oxygen/carbon/iron 2%',
    discovered: 'prehistoric',
    blurb:
      'A G2V main-sequence star holding 99.86% of the mass of the solar system. Fuses ~600 million tonnes of hydrogen every second; the light reaching Earth left the surface 8 minutes 20 seconds ago.',
  },
}

// ---------------------------------------------------------------------------
// Planets
// ---------------------------------------------------------------------------

export const PLANETS: BodySpec[] = [
  {
    key: 'mercury',
    name: 'Mercury',
    type: 'planet',
    parent: 'sun',
    radiusKm: 2439.7,
    flattening: 0,
    spin: { poleRa: 281.0103, poleRaDot: -0.0328, poleDec: 61.4155, poleDecDot: -0.0049, w0: 329.5988, wDot: 6.1385108 },
    color: 0x9c8e82,
    textures: { map: 'mercury.jpg' },
    facts: {
      mass: 3.3011e23,
      gravity: 3.7,
      escapeVelocity: 4.25,
      rotationHours: 1407.6,
      axialTilt: 0.034,
      temperatureC: 167,
      albedo: 0.088,
      composition: 'Iron core filling 85% of the radius, thin silicate mantle',
      discovered: 'prehistoric',
      blurb:
        'Locked in a 3:2 spin-orbit resonance, so a solar day lasts two Mercurian years. Surface swings from -180 to 430 C, yet radar finds water ice in permanently shadowed polar craters.',
    },
  },
  {
    key: 'venus',
    name: 'Venus',
    type: 'planet',
    parent: 'sun',
    radiusKm: 6051.8,
    flattening: 0,
    spin: { poleRa: 272.76, poleDec: 67.16, w0: 160.2, wDot: -1.4813688 },
    color: 0xe8cfa0,
    textures: { map: 'venus_surface.jpg', clouds: 'venus_atmosphere.jpg' },
    atmosphere: {
      thicknessKm: 250,
      rayleigh: [0.9, 0.75, 0.45],
      mie: 0.9,
      density: 3.4,
      groundTint: [1.0, 0.85, 0.55],
    },
    facts: {
      mass: 4.8675e24,
      gravity: 8.87,
      escapeVelocity: 10.36,
      rotationHours: -5832.5,
      axialTilt: 177.36,
      temperatureC: 464,
      albedo: 0.76,
      composition: '96.5% CO2 atmosphere at 92 bar, basaltic surface',
      discovered: 'prehistoric',
      blurb:
        'Rotates backwards, once every 243 days — slower than its 225-day year. A runaway greenhouse keeps the surface at 464 C everywhere, day or night, pole or equator.',
    },
  },
  {
    key: 'earth',
    name: 'Earth',
    type: 'planet',
    parent: 'sun',
    radiusKm: 6378.137,
    flattening: 1 / 298.257223563,
    spin: { poleRa: 0.0, poleRaDot: -0.641, poleDec: 90.0, poleDecDot: -0.557, w0: 190.147, wDot: 360.9856235 },
    color: 0x2b5c8a,
    textures: {
      map: 'earth_day.jpg',
      night: 'earth_night.jpg',
      clouds: 'earth_clouds.jpg',
      normal: 'earth_normal.jpg',
      specular: 'earth_specular.jpg',
    },
    atmosphere: {
      thicknessKm: 100,
      rayleigh: [0.19, 0.45, 1.0],
      mie: 0.22,
      density: 1.0,
      groundTint: [1.0, 0.6, 0.35],
    },
    facts: {
      mass: 5.97237e24,
      gravity: 9.807,
      escapeVelocity: 11.186,
      rotationHours: 23.9344696,
      axialTilt: 23.4393,
      temperatureC: 15,
      albedo: 0.306,
      composition: '78% N2 / 21% O2 atmosphere, silicate mantle, iron-nickel core',
      discovered: 'n/a',
      blurb:
        'The only place known to have liquid water oceans, plate tectonics and life. Its unusually large moon stabilises the axial tilt, keeping the climate steadier than it would otherwise be.',
    },
  },
  {
    key: 'mars',
    name: 'Mars',
    type: 'planet',
    parent: 'sun',
    radiusKm: 3396.2,
    flattening: 0.00589,
    spin: { poleRa: 317.681, poleRaDot: -0.106, poleDec: 52.887, poleDecDot: -0.061, w0: 176.63, wDot: 350.89198226 },
    color: 0xc1502e,
    textures: { map: 'mars.jpg' },
    atmosphere: {
      thicknessKm: 60,
      rayleigh: [0.55, 0.4, 0.32],
      mie: 0.55,
      density: 0.16,
      groundTint: [0.75, 0.55, 0.45],
    },
    facts: {
      mass: 6.4171e23,
      gravity: 3.721,
      escapeVelocity: 5.027,
      rotationHours: 24.622962,
      axialTilt: 25.19,
      temperatureC: -65,
      albedo: 0.25,
      composition: '95% CO2 at 6 mbar, iron-oxide dust over basalt',
      discovered: 'prehistoric',
      blurb:
        'Home to Olympus Mons, 22 km tall, and Valles Marineris, a canyon system stretching a fifth of the way around the planet. Dust storms occasionally shroud the entire globe for weeks.',
    },
  },
  {
    key: 'jupiter',
    name: 'Jupiter',
    type: 'planet',
    parent: 'sun',
    radiusKm: 71_492,
    flattening: 0.06487,
    spin: { poleRa: 268.056595, poleRaDot: -0.006499, poleDec: 64.495303, poleDecDot: 0.002413, w0: 284.95, wDot: 870.536 },
    color: 0xc9a882,
    textures: { map: 'jupiter.jpg' },
    atmosphere: {
      thicknessKm: 1200,
      rayleigh: [0.7, 0.6, 0.45],
      mie: 0.4,
      density: 0.7,
      groundTint: [0.95, 0.85, 0.7],
    },
    rings: [
      {
        name: 'Halo',
        innerKm: 92_000,
        outerKm: 122_500,
        opacity: 0.035,
        exploreBoost: 60,
        exploreBrightness: 3,
        note: 'dust lofted by electromagnetic forces',
        bands: [{ name: 'Halo', innerKm: 92_000, outerKm: 122_500, tau: 1e-6, color: 0x7a6250 }],
      },
      {
        name: 'Main ring',
        innerKm: 122_500,
        outerKm: 129_000,
        opacity: 0.16,
        exploreBoost: 25,
        exploreBrightness: 3,
        note: 'debris from Adrastea and Metis',
        // Jupiter's rings are dust, not ice: reddish, and optically thin enough
        // to see stars through. The outer edge is Adrastea's orbit, because
        // that is where the dust comes from.
        bands: [
          { name: 'Main ring (inner)', innerKm: 122_500, outerKm: 128_000, tau: 3e-6, color: 0x9a7358 },
          {
            name: 'Main ring (bright core)',
            innerKm: 128_000,
            outerKm: 129_000,
            tau: 6e-6,
            color: 0xa87d5e,
            cause: 'bounded by the orbits of Metis and Adrastea, its sources',
          },
        ],
      },
      {
        name: 'Gossamer rings',
        innerKm: 129_000,
        outerKm: 226_000,
        opacity: 0.025,
        exploreBoost: 90,
        exploreBrightness: 4,
        note: 'fed by Amalthea and Thebe',
        bands: [
          {
            name: 'Amalthea gossamer ring',
            innerKm: 129_000,
            outerKm: 182_000,
            tau: 1e-7,
            color: 0x8a6a56,
            cause: 'dust knocked off Amalthea, bounded by its orbit',
          },
          {
            name: 'Thebe gossamer ring',
            innerKm: 182_000,
            outerKm: 226_000,
            tau: 3e-8,
            color: 0x8a6a56,
            cause: 'dust knocked off Thebe, bounded by its orbit',
          },
        ],
      },
    ],
    facts: {
      mass: 1.8982e27,
      gravity: 24.79,
      escapeVelocity: 59.5,
      rotationHours: 9.925,
      axialTilt: 3.13,
      temperatureC: -110,
      albedo: 0.503,
      composition: '90% H2 / 10% He, likely a diffuse rocky-ice core',
      discovered: 'prehistoric',
      blurb:
        'More massive than every other planet combined. The Great Red Spot is a storm wider than Earth that has been under observation for over 190 years. Rotates in under 10 hours, visibly flattening the disc.',
    },
  },
  {
    key: 'saturn',
    name: 'Saturn',
    type: 'planet',
    parent: 'sun',
    radiusKm: 60_268,
    flattening: 0.09796,
    spin: { poleRa: 40.589, poleRaDot: -0.036, poleDec: 83.537, poleDecDot: -0.004, w0: 38.9, wDot: 810.7939024 },
    color: 0xd9c08a,
    textures: { map: 'saturn.jpg' },
    atmosphere: {
      thicknessKm: 1100,
      rayleigh: [0.75, 0.68, 0.5],
      mie: 0.45,
      density: 0.6,
      groundTint: [0.98, 0.92, 0.75],
    },
    rings: [
      {
        name: 'D ring',
        innerKm: 66_900,
        outerKm: 74_510,
        opacity: 1,
        exploreBoost: 3,
        exploreBrightness: 1.4,
        note: 'faint, innermost, almost touching the cloud tops',
        bands: [{ name: 'D ring', innerKm: 66_900, outerKm: 74_510, tau: 0.001, color: 0x8c8378 }],
      },
      {
        // Kept at the photometric strip's own registration: saturn_ring.png
        // spans exactly this range, so moving the edges would slide every
        // ringlet in it. The bands below cover the same span and stand in until
        // the image loads.
        name: 'Main rings (C, B, Cassini division, A, F)',
        innerKm: 74_500,
        outerKm: 140_220,
        texture: 'saturn_ring.png',
        opacity: 1.0,
        note: 'over 99% water ice, on average only ~10 m thick',
        // Boundaries from Voyager and Cassini occultations. The two colours
        // are real: the B ring's dense, fresh ice reads warm and tan, while the
        // sparse C ring and Cassini Division are greyer, being both thinner and
        // more contaminated. Every named gap here is cross-checked in
        // `pnpm validate` against the moon or resonance that clears it — if a
        // radius is wrong, its shepherd is no longer standing in it.
        bands: [
          { name: 'C ring', innerKm: 74_500, outerKm: 77_870, tau: 0.08, color: 0x9c9080 },
          {
            name: 'Colombo Gap (Titan Ringlet)',
            innerKm: 77_870,
            outerKm: 77_970,
            tau: 0,
            color: 0x9c9080,
            cause: 'Titan 1:0 apsidal resonance',
          },
          { name: 'C ring (outer)', innerKm: 77_970, outerKm: 87_491, tau: 0.1, color: 0x9c9080 },
          {
            name: 'Maxwell Gap',
            innerKm: 87_491,
            outerKm: 87_591,
            tau: 0,
            color: 0x9c9080,
            cause: 'a confined eccentric ringlet',
          },
          { name: 'C ring (outermost)', innerKm: 87_591, outerKm: 91_975, tau: 0.12, color: 0x9c9080 },
          { name: 'B ring (inner)', innerKm: 91_975, outerKm: 99_000, tau: 0.9, color: 0xc4ab8a },
          { name: 'B ring (central)', innerKm: 99_000, outerKm: 110_000, tau: 2.1, color: 0xd8c2a0 },
          { name: 'B ring (outer)', innerKm: 110_000, outerKm: 117_580, tau: 1.4, color: 0xcdb694 },
          {
            name: 'Huygens Gap',
            innerKm: 117_580,
            outerKm: 117_930,
            tau: 0,
            color: 0x9c9080,
            cause: 'Mimas 2:1 resonance, which also holds the B ring edge',
          },
          {
            name: 'Cassini Division',
            innerKm: 117_930,
            outerKm: 122_170,
            tau: 0.12,
            color: 0x9a8e7d,
            cause: 'cleared by the Mimas 2:1 resonance',
          },
          { name: 'A ring (inner)', innerKm: 122_170, outerKm: 133_424, tau: 0.62, color: 0xc0a98c },
          {
            name: 'Encke Gap',
            innerKm: 133_424,
            outerKm: 133_749,
            tau: 0,
            color: 0xc0a98c,
            cause: 'swept clear by Pan, which orbits inside it',
          },
          { name: 'A ring (outer)', innerKm: 133_749, outerKm: 136_487, tau: 0.5, color: 0xc0a98c },
          {
            name: 'Keeler Gap',
            innerKm: 136_487,
            outerKm: 136_522,
            tau: 0,
            color: 0xc0a98c,
            cause: 'swept clear by Daphnis, which raises waves on its edges',
          },
          {
            name: 'A ring (edge)',
            innerKm: 136_522,
            outerKm: 136_775,
            tau: 0.45,
            color: 0xc0a98c,
            cause: 'outer edge held by the Janus/Epimetheus 7:6 resonance',
          },
          { name: 'Roche Division', innerKm: 136_775, outerKm: 139_380, tau: 0.002, color: 0x8c8378 },
          {
            name: 'F ring',
            innerKm: 140_140,
            outerKm: 140_220,
            tau: 0.1,
            color: 0xd5c7ae,
            cause: 'shepherded by Prometheus and Pandora',
          },
        ],
      },
      {
        name: 'E ring',
        innerKm: 180_000,
        outerKm: 480_000,
        opacity: 1,
        exploreBoost: 4,
        exploreBrightness: 1.4,
        note: 'fed by the plumes of Enceladus',
        bands: [
          { name: 'E ring (inner)', innerKm: 180_000, outerKm: 230_000, tau: 1e-6, color: 0xaebccc },
          {
            name: 'E ring (peak)',
            innerKm: 230_000,
            outerKm: 250_000,
            tau: 1e-5,
            color: 0xc2d2e4,
            cause: 'densest at the orbit of Enceladus, its source',
          },
          { name: 'E ring (outer)', innerKm: 250_000, outerKm: 480_000, tau: 1e-6, color: 0xaebccc },
        ],
      },
    ],
    facts: {
      mass: 5.6834e26,
      gravity: 10.44,
      escapeVelocity: 35.5,
      rotationHours: 10.656,
      axialTilt: 26.73,
      temperatureC: -140,
      albedo: 0.342,
      composition: '96% H2 / 3% He; mean density 0.687 g/cm3',
      discovered: 'prehistoric',
      blurb:
        'Less dense than water. Its rings span three quarters of the Earth-Moon distance yet are only about ten metres thick, and a persistent hexagonal jet stream circles the north pole.',
    },
  },
  {
    key: 'uranus',
    name: 'Uranus',
    type: 'planet',
    parent: 'sun',
    radiusKm: 25_559,
    flattening: 0.02293,
    spin: { poleRa: 257.311, poleDec: -15.175, w0: 203.81, wDot: -501.1600928 },
    color: 0x9fd8e0,
    textures: { map: 'uranus.jpg' },
    atmosphere: {
      thicknessKm: 900,
      rayleigh: [0.35, 0.8, 0.95],
      mie: 0.25,
      density: 0.85,
      groundTint: [0.6, 0.9, 0.95],
    },
    rings: [
      {
        name: 'Inner rings (6 through epsilon)',
        innerKm: 41_600,
        outerKm: 51_300,
        opacity: 1,
        exploreBoost: 6,
        exploreBrightness: 7,
        note: 'nine narrow, dark, sharply confined rings',
        // Among the darkest objects in the solar system — geometric albedo
        // around 0.03, charcoal rather than the tan of Saturn's ice. They are
        // also extraordinarily narrow: several are a couple of kilometres wide
        // across a 9,000 km span, which is why the profile is integrated per
        // texel rather than point-sampled. Epsilon is both the widest and the
        // most eccentric, running 20 km at periapse to 96 km at apoapse.
        bands: [
          { name: 'Ring 6', innerKm: 41_836, outerKm: 41_838, tau: 0.3, color: 0x2a2724 },
          { name: 'Ring 5', innerKm: 42_234, outerKm: 42_236, tau: 0.5, color: 0x2a2724 },
          { name: 'Ring 4', innerKm: 42_570, outerKm: 42_573, tau: 0.3, color: 0x2a2724 },
          { name: 'Alpha ring', innerKm: 44_714, outerKm: 44_722, tau: 0.4, color: 0x2e2b27 },
          { name: 'Beta ring', innerKm: 45_657, outerKm: 45_665, tau: 0.3, color: 0x2e2b27 },
          { name: 'Eta ring', innerKm: 47_175, outerKm: 47_177, tau: 0.25, color: 0x2a2724 },
          {
            name: 'Gamma ring',
            innerKm: 47_625, outerKm: 47_628, tau: 0.5, color: 0x2a2724,
            cause: 'confined by an Ophelia 6:5 resonance',
          },
          { name: 'Delta ring', innerKm: 48_298, outerKm: 48_303, tau: 0.4, color: 0x2a2724 },
          { name: 'Lambda ring', innerKm: 50_023, outerKm: 50_026, tau: 0.1, color: 0x333029 },
          {
            name: 'Epsilon ring',
            innerKm: 51_120, outerKm: 51_179, tau: 1.5, color: 0x38342e,
            cause: 'shepherded between Cordelia and Ophelia',
          },
        ],
      },
      {
        name: 'Outer rings (nu, mu)',
        innerKm: 66_100,
        outerKm: 103_000,
        opacity: 1,
        exploreBoost: 5,
        exploreBrightness: 2.5,
        note: 'dusty; mu peaks at the orbit of Mab',
        // The odd pair: nu is red like most dusty rings, while mu is blue —
        // the only other blue ring known besides Saturn's E ring, and for the
        // same reason, a small icy moon feeding it fresh sub-micron grains.
        bands: [
          { name: 'Nu ring', innerKm: 66_100, outerKm: 69_900, tau: 1e-5, color: 0x6b4b3c },
          { name: '(empty)', innerKm: 69_900, outerKm: 86_000, tau: 0, color: 0x000000 },
          {
            name: 'Mu ring',
            innerKm: 86_000, outerKm: 103_000, tau: 8e-6, color: 0x8fa8c4,
            cause: 'peaks at the orbit of Mab, its source',
          },
        ],
      },
    ],
    facts: {
      mass: 8.681e25,
      gravity: 8.69,
      escapeVelocity: 21.3,
      rotationHours: -17.24,
      axialTilt: 97.77,
      temperatureC: -195,
      albedo: 0.3,
      composition: 'H2/He envelope over a water-ammonia-methane "ice" mantle',
      discovered: '1781, William Herschel',
      blurb:
        'Tipped almost onto its side, so each pole spends 42 years in sunlight and 42 in darkness. The coldest atmosphere in the solar system, bottoming out at -224 C despite Neptune being further out.',
    },
  },
  {
    key: 'neptune',
    name: 'Neptune',
    type: 'planet',
    parent: 'sun',
    radiusKm: 24_764,
    flattening: 0.01708,
    spin: { poleRa: 299.36, poleDec: 43.46, w0: 253.18, wDot: 536.3128492 },
    color: 0x3f66c4,
    textures: { map: 'neptune.jpg' },
    atmosphere: {
      thicknessKm: 900,
      rayleigh: [0.22, 0.5, 1.0],
      mie: 0.28,
      density: 0.95,
      groundTint: [0.4, 0.6, 1.0],
    },
    rings: [
      {
        name: 'Galle, Le Verrier, Lassell, Arago',
        innerKm: 40_900,
        outerKm: 57_600,
        opacity: 0.05,
        exploreBoost: 220,
        exploreBrightness: 6,
        bands: [
          { name: 'Galle ring', innerKm: 40_900, outerKm: 42_900, tau: 1e-4, color: 0x4a3a33 },
          { name: '(empty)', innerKm: 42_900, outerKm: 53_150, tau: 0, color: 0x000000 },
          { name: 'Le Verrier ring', innerKm: 53_150, outerKm: 53_250, tau: 0.01, color: 0x5a453b },
          {
            name: 'Lassell ring (plateau)',
            innerKm: 53_250, outerKm: 57_200, tau: 1e-4, color: 0x4a3a33,
          },
          { name: 'Arago ring', innerKm: 57_200, outerKm: 57_300, tau: 1e-3, color: 0x5a453b },
        ],
      },
      {
        name: 'Adams ring',
        innerKm: 62_800,
        outerKm: 63_100,
        opacity: 0.12,
        exploreBoost: 220,
        exploreBrightness: 6,
        note: 'contains five bright dust arcs',
        bands: [
          {
            name: 'Adams ring',
            innerKm: 62_915, outerKm: 62_950, tau: 0.01, color: 0x5a453b,
            cause: 'arcs confined by a Galatea 42:43 resonance',
          },
        ],
      },
    ],
    facts: {
      mass: 1.02413e26,
      gravity: 11.15,
      escapeVelocity: 23.5,
      rotationHours: 16.11,
      axialTilt: 28.32,
      temperatureC: -200,
      albedo: 0.29,
      composition: 'H2/He/CH4 over a hot, dense water-ammonia mantle',
      discovered: '1846, Le Verrier, Galle and d’Arrest',
      blurb:
        'Found by mathematics before it was seen: predicted from irregularities in Uranus’s orbit and spotted within a degree of the prediction. Its winds reach 2,100 km/h, the fastest measured anywhere.',
    },
  },
]

// ---------------------------------------------------------------------------
// Dwarf planets
//
// Pluto keeps a full spec because we render its satellite system; the others
// are driven by the Minor Planet Center elements in data/generated and only
// need physical/visual properties here.
// ---------------------------------------------------------------------------

export const DWARF_PLANETS: BodySpec[] = [
  {
    key: 'pluto',
    name: 'Pluto',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 1188.3,
    flattening: 0,
    spin: { poleRa: 132.993, poleDec: -6.163, w0: 302.695, wDot: 56.3625225 },
    color: 0xc4a68a,
    textures: { map: 'pluto.jpg' },
    // The New Horizons mosaic we bundle is LORRI panchromatic. This restores
    // Pluto's measured global colour over real detail; see ATTRIBUTION.md.
    textureTint: 0xffd8b4,
    atmosphere: {
      thicknessKm: 50,
      rayleigh: [0.5, 0.55, 0.7],
      mie: 0.6,
      density: 0.08,
      groundTint: [0.7, 0.75, 0.85],
    },
    facts: {
      mass: 1.303e22,
      gravity: 0.62,
      escapeVelocity: 1.21,
      rotationHours: -153.2928,
      axialTilt: 122.53,
      temperatureC: -229,
      albedo: 0.52,
      composition: 'Nitrogen-ice surface over a large rocky core; ~70% rock by mass',
      discovered: '1930, Clyde Tombaugh',
      blurb:
        'Mutually tidally locked with Charon, the two orbiting a barycentre outside Pluto’s surface. New Horizons found nitrogen-ice glaciers flowing across Sputnik Planitia and mountains of water ice 3 km high.',
    },
  },
  {
    key: 'ceres',
    name: 'Ceres',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 469.7,
    flattening: 0.075,
    spin: { poleRa: 291.418, poleDec: 66.764, w0: 170.65, wDot: 952.1532 },
    color: 0x8a8378,
    textures: { map: 'ceres.jpg' },
    facts: {
      mass: 9.3839e20,
      gravity: 0.28,
      escapeVelocity: 0.51,
      rotationHours: 9.074,
      axialTilt: 4,
      temperatureC: -105,
      albedo: 0.09,
      composition: 'Hydrated silicates over a possible briny subsurface layer',
      discovered: '1801, Giuseppe Piazzi',
      blurb:
        'The largest object in the asteroid belt and the only dwarf planet inside Neptune’s orbit, holding about a third of the belt’s entire mass. The bright spots in Occator crater are sodium carbonate left by escaping brine.',
    },
  },
  {
    key: 'eris',
    name: 'Eris',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 1163,
    flattening: 0,
    spin: { poleRa: 0, poleDec: 90, w0: 0, wDot: 22.6 },
    color: 0xd8d2c8,
    textures: { map: 'eris.jpg' },
    facts: {
      mass: 1.6466e22,
      gravity: 0.82,
      escapeVelocity: 1.38,
      rotationHours: 15.79,
      axialTilt: 78,
      temperatureC: -231,
      albedo: 0.96,
      composition: 'Methane-ice frost over rock; among the most reflective bodies known',
      discovered: '2005, Brown, Trujillo and Rabinowitz',
      blurb:
        'Slightly more massive than Pluto, and the discovery that forced the IAU to define "planet" in 2006. Currently near aphelion at 96 AU, its atmosphere frozen flat onto the surface.',
    },
  },
  {
    key: 'haumea',
    name: 'Haumea',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 816,
    // Spins so fast it is a triaxial ellipsoid, roughly 2100 x 1680 x 1074 km.
    flattening: 0.49,
    spin: { poleRa: 285, poleDec: -12, w0: 0, wDot: 1057.9 },
    color: 0xe0ded8,
    textures: { map: 'haumea.jpg' },
    facts: {
      mass: 4.006e21,
      gravity: 0.4,
      escapeVelocity: 0.91,
      rotationHours: 3.9155,
      axialTilt: 126,
      temperatureC: -241,
      albedo: 0.51,
      composition: 'Crystalline water ice over a rocky interior',
      discovered: '2004, Ortiz et al. / Brown et al.',
      blurb:
        'Rotates once every 3.9 hours — so fast it has been stretched into a rugby-ball shape twice as long as it is thick. It has two moons and the only ring system known around a trans-Neptunian object.',
    },
  },
  {
    key: 'makemake',
    name: 'Makemake',
    type: 'dwarf',
    parent: 'sun',
    radiusKm: 715,
    flattening: 0,
    spin: { poleRa: 0, poleDec: 90, w0: 0, wDot: 31.3 },
    color: 0xc9a086,
    textures: { map: 'makemake.jpg' },
    facts: {
      mass: 3.1e21,
      gravity: 0.5,
      escapeVelocity: 0.8,
      rotationHours: 22.83,
      axialTilt: 0,
      temperatureC: -239,
      albedo: 0.81,
      composition: 'Methane and ethane ices, reddened by irradiation',
      discovered: '2005, Michael Brown et al.',
      blurb:
        'The second-brightest Kuiper belt object after Pluto. Its surface carries centimetre-sized methane ice grains, unusually large, and a single dark moon was found in 2016.',
    },
  },
]

export const ALL_BODY_SPECS: BodySpec[] = [SUN, ...PLANETS, ...DWARF_PLANETS]

export const BODY_SPECS_BY_KEY: Map<string, BodySpec> = new Map(
  ALL_BODY_SPECS.map((b) => [b.key, b]),
)

/**
 * Fallback colours for satellites, by parent, so procedurally textured moons
 * still read as belonging to their system.
 */
export const MOON_TINTS: Record<string, number> = {
  earth: 0x9a9a95,
  mars: 0x7d6a5a,
  jupiter: 0xa89a86,
  saturn: 0xbfb6a4,
  uranus: 0x8f9498,
  neptune: 0x8a8f96,
  pluto: 0xa89c90,
}

/**
 * Named textures for the moons we have real imagery for.
 *
 * Coverage deliberately follows *interest*, not size: Phobos is 11 km across and
 * still one of the first places anyone looks, so it gets a real Mars Express
 * mosaic while larger but duller bodies stay procedural.
 */
export const MOON_TEXTURES: Record<string, string> = {
  Moon: 'moon.jpg',
  // Jupiter
  Io: 'io.jpg',
  Europa: 'europa.jpg',
  Ganymede: 'ganymede.jpg',
  Callisto: 'callisto.jpg',
  // Mars
  Phobos: 'phobos.jpg',
  // High-pass filtered, so it carries relief detail rather than true albedo —
  // the only global mosaic of Deimos there is, and better than a synthesised one.
  Deimos: 'deimos.png',
  // Saturn
  Mimas: 'mimas.jpg',
  Enceladus: 'enceladus.jpg',
  // The only picture of Titan's ground that exists: ISS's 938 nm methane window
  // sees through the haze, which nothing at visible wavelengths does. Left
  // untinted — the orange everyone pictures is the atmosphere, and the shell in
  // MOON_ATMOSPHERES puts it back where it belongs.
  Titan: 'titan.jpg',
  Tethys: 'tethys.jpg',
  Dione: 'dione.jpg',
  Rhea: 'rhea.jpg',
  Iapetus: 'iapetus.jpg',
  Phoebe: 'phoebe.jpg',
  // Uranus. Half of each of these is blank, and that is the honest state of the
  // record: Voyager 2 arrived at southern summer solstice in 1986, so the
  // northern hemispheres were in polar night and no spacecraft has been back.
  // Recovered from the only controlled photomosaics ever published of them,
  // printed on USGS map sheet I-1920 in 1988.
  Miranda: 'miranda.png',
  Ariel: 'ariel.png',
  Umbriel: 'umbriel.png',
  Titania: 'titania.png',
  Oberon: 'oberon.png',
  // Neptune
  Triton: 'triton.jpg',
  // Pluto
  Charon: 'charon.jpg',
}

/**
 * Satellites with an atmosphere worth rendering. Only Titan qualifies.
 *
 * Every other moon in the solar system has at most a wisp — Io's SO₂ and
 * Triton's nitrogen are microbars, invisible at any scale — while Titan's
 * surface pressure is 1.45 bar, half again Earth's, on a body two fifths of
 * Earth's radius. Rendered as a bare sphere it loses the single fact everyone
 * knows about it.
 *
 * Parameters are appearance, not measurement, the same as the planets': the
 * shell is five scale heights of the *visible* haze, taken at 120 km so the
 * shell tops out near 600 km, where Cassini's detached haze layer sits. The
 * strong Mie term and the near-total loss of blue are what make Titan orange;
 * the haze is aerosol almost all the way down, which is why it is the one body
 * here whose Mie scattering outweighs its Rayleigh.
 */
export const MOON_ATMOSPHERES: Record<string, AtmosphereSpec> = {
  Titan: {
    thicknessKm: 120,
    rayleigh: [0.95, 0.6, 0.22],
    mie: 1.2,
    density: 2.2,
    groundTint: [1.0, 0.72, 0.35],
  },
}

/**
 * Textures for catalogued minor planets. These bodies are point-rendered until
 * you approach one, at which point the promotion path picks this up in place of
 * a synthesised surface.
 */
export const SMALL_BODY_TEXTURES: Record<string, string> = {
  Vesta: 'vesta.jpg',
  Eros: 'eros.jpg',
}

/**
 * Measured mean radii, km, for minor planets that have actually been visited or
 * resolved.
 *
 * Everything else falls back to `D = 1329 / sqrt(albedo) * 10^(-H/5)`, which is
 * a decent estimator across a population and can be badly wrong for an
 * individual: it puts Vesta at 384 km against a measured 262.7, because Vesta is
 * far brighter than the family albedo assumed for it. That matters beyond the
 * label once a body carries a shape model, since the model's radii are absolute.
 */
export const SMALL_BODY_RADII: Record<string, number> = {
  Vesta: 262.7,
  // Eros is 34 x 11 x 11 km; the magnitude estimator, which assumes a sphere,
  // has no way to know that and lands nowhere near.
  Eros: 8.42,
}

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
}

/**
 * Notable moons, surfaced first in the browser and given a description in the
 * info panel. Everything else is still fully simulated, just less annotated.
 */
export const MOON_NOTES: Record<string, string> = {
  Moon: 'Formed from debris of a Mars-sized impact 4.5 Gyr ago. Recedes from Earth by 3.8 cm per year.',
  Phobos: 'Spiralling inward; will break up into a ring or strike Mars within 50 million years.',
  Deimos: 'So small and distant that from the Martian surface it looks like a moving star.',
  Io: 'The most volcanically active body in the solar system, squeezed by resonance with Europa and Ganymede.',
  Europa: 'A water ocean twice Earth’s volume beneath 15-25 km of ice, the leading target in the search for life.',
  Ganymede: 'Larger than Mercury, and the only moon with its own magnetic field.',
  Callisto: 'The most heavily cratered surface known — essentially unchanged for 4 billion years.',
  Amalthea: 'Redder than anything else near Jupiter, and less dense than water ice.',
  Titan: 'Thicker atmosphere than Earth’s, with rivers, lakes and seas of liquid methane and ethane.',
  Enceladus: 'Vents water vapour from a subsurface ocean through south-polar fissures, feeding Saturn’s E ring.',
  Mimas: 'Herschel crater spans a third of its diameter; the impact nearly shattered it.',
  Iapetus: 'One hemisphere is as dark as coal, the other as bright as snow, split by an equatorial ridge 13 km high.',
  Hyperion: 'Tumbles chaotically — its orientation is genuinely unpredictable.',
  Rhea: 'Saturn’s second largest moon, an icy, ancient, heavily cratered world.',
  Titania: 'The largest Uranian moon, scarred by Messina Chasmata, a 1,500 km rift.',
  Miranda: 'Verona Rupes is a 20 km cliff, the tallest known anywhere.',
  Triton: 'Orbits backwards, so it was captured, not formed in place. Nitrogen geysers erupt through its polar cap.',
  Nereid: 'One of the most eccentric orbits of any moon: 1.4 to 9.7 million km from Neptune.',
  Charon: 'Half Pluto’s diameter — the two are effectively a double dwarf planet orbiting a shared barycentre.',
  Proteus: 'About as large as a body can be while remaining irregular rather than spherical.',
  Phoebe: 'Retrograde and captured, probably a Centaur from the Kuiper belt.',
  Janus: 'Swaps orbits with Epimetheus every four years without ever colliding.',
  Epimetheus: 'Trades places with Janus in a stable co-orbital dance.',
  Pan: 'Shaped like a ravioli, sweeping the Encke Gap clear inside the A ring.',
  Prometheus: 'Steals material from the F ring, drawing out streamers and channels.',
  Hippocamp: 'Only 34 km across, probably chipped off Proteus by an ancient impact.',
}
