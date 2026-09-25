/** The belt swarms, with orbits solved on the GPU. */

import { AdditiveBlending, ShaderMaterial, Texture, Vector2, Vector3 } from 'three';
import swarmFragmentShader from '../shaders/swarm.frag.glsl?raw';
import swarmVertexShader from '../shaders/swarm.vert.glsl?raw';
import { prepare } from './chunks.ts';

/**
 * Points material that propagates each particle's own Keplerian orbit in the
 * vertex shader. Uploading ~70,000 sets of elements once and advancing them on
 * the GPU is what makes a live, correctly-structured belt affordable.
 *
 * The scale remapping is duplicated here in GLSL to match ScaleModel exactly.
 */
export function createSwarmMaterial(sprite: Texture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uSprite: { value: prepare(sprite) },
      uDays: { value: 0 },
      uAuKm: { value: 149597870.7 },
      uSceneUnitKm: { value: 1000 },
      uBlend: { value: 1 },
      uHelioExp: { value: 0.6 },
      uPointScale: { value: 1 },
      uOpacity: { value: 1 },
      uSunPos: { value: new Vector3() },
      uPixelRatio: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
    },
    vertexShader: swarmVertexShader,
    fragmentShader: swarmFragmentShader,
  });
}
