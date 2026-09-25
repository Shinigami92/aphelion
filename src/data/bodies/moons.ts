/** What the satellite table leaves out: colours, imagery, atmospheres and notes for moons. */

import type { AtmosphereSpec } from '../body-spec.ts';

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
};

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
};

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
    // By far the thickest here, and the only figure over 1: the tholin haze runs
    // to tau ~ 2-5 at visible wavelengths, which is why Titan has no visible
    // surface from outside and why Huygens had to be landed blind. The shell is
    // additive, so the surface map still shows through where the real thing would
    // not — the compromise that keeps the newly added imagery worth having.
    density: 2.5,
    groundTint: [1.0, 0.72, 0.35],
  },
};

/**
 * Notable moons, surfaced first in the browser and given a description in the
 * info panel. Everything else is still fully simulated, just less annotated.
 */
export const MOON_NOTES: Record<string, string> = {
  Moon: 'Formed from debris of a Mars-sized impact 4.5 Gyr ago. Recedes from Earth by 3.8 cm per year.',
  Phobos: 'Spiralling inward; will break up into a ring or strike Mars within 50 million years.',
  Deimos: 'So small and distant that from the Martian surface it looks like a moving star.',
  Io: 'The most volcanically active body in the solar system, squeezed by resonance with Europa and Ganymede.',
  Europa:
    'A water ocean twice Earth’s volume beneath 15-25 km of ice, the leading target in the search for life.',
  Ganymede: 'Larger than Mercury, and the only moon with its own magnetic field.',
  Callisto: 'The most heavily cratered surface known — essentially unchanged for 4 billion years.',
  Amalthea: 'Redder than anything else near Jupiter, and less dense than water ice.',
  Titan:
    'Thicker atmosphere than Earth’s, with rivers, lakes and seas of liquid methane and ethane.',
  Enceladus:
    'Vents water vapour from a subsurface ocean through south-polar fissures, feeding Saturn’s E ring.',
  Mimas: 'Herschel crater spans a third of its diameter; the impact nearly shattered it.',
  Iapetus:
    'One hemisphere is as dark as coal, the other as bright as snow, split by an equatorial ridge 13 km high.',
  Hyperion: 'Tumbles chaotically — its orientation is genuinely unpredictable.',
  Rhea: 'Saturn’s second largest moon, an icy, ancient, heavily cratered world.',
  Titania: 'The largest Uranian moon, scarred by Messina Chasmata, a 1,500 km rift.',
  Miranda: 'Verona Rupes is a 20 km cliff, the tallest known anywhere.',
  Triton:
    'Orbits backwards, so it was captured, not formed in place. Nitrogen geysers erupt through its polar cap.',
  Nereid: 'One of the most eccentric orbits of any moon: 1.4 to 9.7 million km from Neptune.',
  Charon:
    'Half Pluto’s diameter — the two are effectively a double dwarf planet orbiting a shared barycentre.',
  Proteus: 'About as large as a body can be while remaining irregular rather than spherical.',
  Phoebe: 'Retrograde and captured, probably a Centaur from the Kuiper belt.',
  Janus: 'Swaps orbits with Epimetheus every four years without ever colliding.',
  Epimetheus: 'Trades places with Janus in a stable co-orbital dance.',
  Pan: 'Shaped like a ravioli, sweeping the Encke Gap clear inside the A ring.',
  Prometheus: 'Steals material from the F ring, drawing out streamers and channels.',
  Hippocamp: 'Only 34 km across, probably chipped off Proteus by an ancient impact.',
};
