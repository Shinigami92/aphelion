/** Imagery and measured radii for the minor planets that have them. */

/**
 * Textures for catalogued minor planets. These bodies are point-rendered until
 * you approach one, at which point the promotion path picks this up in place of
 * a synthesised surface.
 */
export const SMALL_BODY_TEXTURES: Record<string, string> = {
  Vesta: 'vesta.jpg',
  Eros: 'eros.jpg',
};

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
};
