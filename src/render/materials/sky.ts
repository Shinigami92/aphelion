/** The deep-sky backdrop and the Hipparcos stars. */

import { AdditiveBlending, BackSide, ShaderMaterial, Texture } from 'three';
import skyFragmentShader from '../shaders/sky.frag.glsl?raw';
import skyVertexShader from '../shaders/sky.vert.glsl?raw';
import starFragmentShader from '../shaders/star.frag.glsl?raw';
import starVertexShader from '../shaders/star.vert.glsl?raw';
import { prepare } from './chunks.ts';

//
// Two layers on one camera-following sphere: the deep sky as a texture, and the
// Hipparcos stars as point sources on top. Both are pinned to the far plane by
// the same one-line trick, described on GLSL_SKY_DEPTH.

/**
 * The deep sky, as an equirectangular texture on the inside of a sphere.
 *
 * The sphere's own frame is ICRF/J2000 equatorial — the caller rotates it into
 * the ecliptic — so u = 0.5 is right ascension zero and v = 0 is the north
 * celestial pole.
 */
export function createSkyMaterial(
  map: Texture,
  opts: { brightness?: number } = {},
): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      uBrightness: { value: opts.brightness ?? 1 },
    },
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
  });
}

/**
 * Real stars, drawn as point sources.
 *
 * Every star is the same optical system's response to a point of light, so the
 * only thing that differs between them is how much light arrives. That single
 * assumption fixes both the size and the brightness law:
 *
 *   - **Brightness follows Pogson**: flux is 10^(-0.4 m), which is the
 *     amplitude at the centre of the sprite, times an exposure.
 *   - **Size is wherever that profile crosses the visibility threshold.** Sirius
 *     is a disc and an eighth-magnitude star is a dot not because the instrument
 *     changed but because the same profile, scaled up 1600-fold, stays above the
 *     threshold much further out.
 *
 * The profile is a **Moffat** function, `1 / (1 + (r/a)^2)^beta`, not a
 * Gaussian. That is the standard empirical model for a stellar image precisely
 * because a Gaussian understates the wings, and the difference is the whole
 * visual hierarchy of the sky: a Gaussian spans only sqrt(m) in radius, giving
 * Sirius barely three times the disc of a naked-eye star, where the Moffat wings
 * put it at ten and the field stops looking like uniform beads. Eight magnitudes
 * is a range of 1600:1 that no display can show as brightness alone, so size has
 * to carry it — which is exactly what it does in a real photograph.
 *
 * Writing the profile in units of the sprite's own radius makes it
 * self-consistent: every star reaches the same brightness at its rim, so `uGain`
 * is not an arbitrary scale but the display's own visibility threshold, and
 * `uMagLimit` is the magnitude at which a star reaches it. The only genuinely
 * chosen number is `uSizeScale`, the width of the point spread function in
 * pixels, and one pixel is the right answer for any sampled optical system.
 *
 * Stars do not twinkle. Scintillation is atmospheric, and there is no
 * atmosphere between this camera and them.
 */
export function createStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      /** Julian years since J2000, for proper motion. */
      uYears: { value: 0 },
      uPixelRatio: { value: 1 },
      /**
       * Magnitude at which a star's disc shrinks to nothing — the limiting
       * magnitude of the render. Set a little fainter than the catalogue's own
       * limit so its faintest stars are still drawn rather than vanishing
       * exactly at the cutoff.
       */
      uMagLimit: { value: 9 },
      /** Width of the point spread function, in pixels. */
      uSizeScale: { value: 1.5 },
      /** The display's visibility threshold, in linear light. */
      uGain: { value: 0.006 },
      uOpacity: { value: 1 },
    },
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
  });
}
