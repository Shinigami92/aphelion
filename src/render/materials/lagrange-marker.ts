/** The Lagrange-point reticles. */

import type { Texture } from 'three';
import { ShaderMaterial } from 'three';
import { LAGRANGE_MARKER_PX } from '../scene/constants.ts';
import lagrangeMarkerFragmentShader from '../shaders/lagrange-marker.frag.glsl?raw';
import lagrangeMarkerVertexShader from '../shaders/lagrange-marker.vert.glsl?raw';

/**
 * Reticles at a constant screen size.
 *
 * The one point sprite in this scene that does *not* shrink with distance.
 * Every other point stands for an object, so its apparent size carries
 * information; a Lagrange point stands for a place, and a place that dwindles
 * as you approach it would be saying something false. Held at a fixed pixel
 * size it behaves as the annotation it is — always legible, never mistaken for
 * a body, and never growing into a disc when you arrive.
 *
 * Not additive, unlike the belt and minor-body sprites: additive blending would
 * let the reticle wash out against the Sun or a lit planet, which is exactly
 * where the interesting points are. Normal alpha keeps it readable over
 * anything, and `depthWrite: false` still stops it punching a hole in the
 * bodies behind it.
 */
export function createLagrangeMarkerMaterial(sprite: Texture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSprite: { value: sprite },
      uPixelRatio: { value: 1 },
      uSize: { value: LAGRANGE_MARKER_PX },
      uOpacity: { value: 0.95 },
    },
    vertexShader: lagrangeMarkerVertexShader,
    fragmentShader: lagrangeMarkerFragmentShader,
  });
}
