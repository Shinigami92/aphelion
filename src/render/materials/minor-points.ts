/** The point sprites of the individually simulated minor bodies. */

import type { Texture } from 'three';
import { AdditiveBlending, ShaderMaterial, Vector2 } from 'three';
import minorPointsFragmentShader from '../shaders/minor-points.frag.glsl?raw';
import minorPointsVertexShader from '../shaders/minor-points.vert.glsl?raw';

/**
 * Points shader for the individually simulated minor bodies. Unlike the swarm
 * shader these already have CPU-computed positions; the shader only handles
 * apparent size and fade.
 */
export function createMinorPointsMaterial(sprite: Texture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uSprite: { value: sprite },
      uPixelRatio: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
      uOpacity: { value: 0.95 },
    },
    vertexShader: minorPointsVertexShader,
    fragmentShader: minorPointsFragmentShader,
  });
}
