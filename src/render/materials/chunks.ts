/**
 * Shared GLSL and the colour pipeline every material relies on.
 *
 * Everything here works in "render space": scene units (1 = 1000 km) offset by
 * the floating origin, so coordinates near the camera stay small enough for
 * float32. Every material receives the Sun's position in the same space.
 *
 * The physically interesting parts:
 *
 *   - Solar eclipses are computed analytically. Each body is handed up to four
 *     occluders and works out what fraction of the Sun's *disc* they cover, so
 *     you get real penumbras: the Moon's shadow sweeping across Earth, Io's dot
 *     crossing Jupiter, Earth's shadow reddening the Moon.
 *   - Saturn's rings shadow the planet and the planet shadows the rings, both
 *     by ray-plane and ray-sphere tests rather than shadow maps (which cannot
 *     span these distances).
 *   - Atmospheres are single-scattering integrations with Rayleigh and Mie
 *     terms, marched in the fragment shader. That is what produces the blue
 *     limb, the reddened terminator and the correct forward-scattering haze
 *     when you look toward the Sun through the atmosphere.
 */

import type { Texture } from 'three';
import { LinearSRGBColorSpace, ShaderChunk } from 'three';
import colorChunk from '../shaders/chunks/color.glsl?raw';
import eclipseChunk from '../shaders/chunks/eclipse.glsl?raw';
import raySphereChunk from '../shaders/chunks/ray_sphere.glsl?raw';
import ringScaleParsChunk from '../shaders/chunks/ring_scale_pars.glsl?raw';
import ringToKmChunk from '../shaders/chunks/ring_to_km.glsl?raw';
import ringToUnitsChunk from '../shaders/chunks/ring_to_units.glsl?raw';
import skyDepthChunk from '../shaders/chunks/sky_depth.glsl?raw';

// Registered as Three.js shader chunks so every stage file can pull them in
// with `#include <aphelion_*>`, the same way it pulls in Three's own
// `<logdepthbuf_*>` chunks. Three resolves includes when it compiles a program,
// and every material file whose shaders include a chunk imports this module, so
// the chunks are registered before the first material can be built.
//
// Compile-time sizes (MAX_OCCLUDERS, ZONAL_SAMPLES, the atmosphere's march
// steps) are passed as `defines` on each material instead, so the GLSL and the
// uniform arrays sized from the same constants cannot drift apart.
Object.assign(ShaderChunk, {
  aphelion_color: colorChunk,
  aphelion_eclipse: eclipseChunk,
  aphelion_ray_sphere: raySphereChunk,
  aphelion_ring_scale_pars: ringScaleParsChunk,
  aphelion_ring_to_units: ringToUnitsChunk,
  aphelion_ring_to_km: ringToKmChunk,
  aphelion_sky_depth: skyDepthChunk,
});

/**
 * Mark a texture as already-linear so Three.js leaves it alone; every custom
 * shader above decodes sRGB itself. Keeps the colour pipeline in one place.
 */
export function prepare(tex: Texture): Texture {
  tex.colorSpace = LinearSRGBColorSpace;
  return tex;
}
