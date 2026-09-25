/** Ring particles, orbiting individually on the GPU. */

import { ShaderMaterial, Texture, Vector3 } from 'three';
import ringParticleFragmentShader from '../shaders/ring-particle.frag.glsl?raw';
import ringParticleVertexShader from '../shaders/ring-particle.vert.glsl?raw';
import { prepare } from './chunks.ts';

/**
 * Individual ring particles, as instanced geometry placed by the vertex shader.
 *
 * A ring is 400,000 km across and its particles are metres wide, so there is no
 * question of drawing all of them. Instead a *patch* of a few thousand rocks
 * follows the camera through the ring, expressed in the ring's own cylindrical
 * frame (radius, arc, height) rather than in world space. Two things fall out
 * of that choice:
 *
 * **Keplerian shear comes for free, and it is the whole effect.** Each particle
 * orbits at its own radius's mean motion, and only the *difference* from the
 * camera's own rate is applied, so material inside you visibly overtakes and
 * material outside falls behind, at the real rate. Standing in the A ring you
 * are not parked in a static field of rocks — you are inside a shear flow. A
 * patch expressed in world space could not show this at all.
 *
 * **Wrapping is in arc, not in a box.** A particle that trails out the back
 * re-enters at the front, which is what a shear flow does anyway, so the
 * recycling is invisible rather than being a seam you can catch.
 *
 * Rocks shrink to nothing toward the patch boundary instead of fading, which
 * avoids needing transparency and therefore avoids sorting several thousand
 * instances every frame. And density is read from the ring's own profile
 * texture, so the gaps really are empty: fly along the A ring and the Encke gap
 * is a clear lane with Pan in it, because the same data drew both.
 */
export interface RingParticleMaterialOptions {
  profile: Texture;
  innerKm: number;
  outerKm: number;
  parentRadiusKm: number;
}

export function createRingParticleMaterial(opts: RingParticleMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uProfile: { value: prepare(opts.profile) },
      uInnerKm: { value: opts.innerKm },
      uOuterKm: { value: opts.outerKm },
      uCamRing: { value: new Vector3(0, 0, 0) },
      uPatchR: { value: 1 },
      uPatchS: { value: 1 },
      uPatchZ: { value: 1 },
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uGmKm: { value: 3.7931207e7 },
      uParticleKm: { value: 1 },
      uSunPos: { value: new Vector3() },
      uPlanetCentre: { value: new Vector3() },
      uPlanetRadius: { value: 1 },
      uParentRadiusKm: { value: opts.parentRadiusKm },
      uBodyScale: { value: 1 },
      uSatExponent: { value: 1 },
      uSatKnee: { value: 3 },
      uScaleBlend: { value: 0 },
      uSceneUnitKm: { value: 1000 },
    },
    vertexShader: ringParticleVertexShader,
    fragmentShader: ringParticleFragmentShader,
  });
}
