/** Planetary rings as a textured annulus. */

import { DoubleSide, ShaderMaterial, Texture, Vector3 } from 'three';
import ringFragmentShader from '../shaders/ring.frag.glsl?raw';
import ringVertexShader from '../shaders/ring.vert.glsl?raw';
import { prepare } from './chunks.ts';

export interface RingMaterialOptions {
  texture: Texture;
  /** Inner edge in true kilometres from the planet's centre. */
  innerKm: number;
  /** Outer edge in true kilometres from the planet's centre. */
  outerKm: number;
  opacity: number;
  parentRadiusKm: number;
}

export function createRingMaterial(opts: RingMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uTex: { value: prepare(opts.texture) },
      uInnerKm: { value: opts.innerKm },
      uOuterKm: { value: opts.outerKm },
      uOpacity: { value: opts.opacity },
      uExploreBoost: { value: 1 },
      uExploreBrightness: { value: 1 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uPlanetCentre: { value: new Vector3() },
      uPlanetRadius: { value: 1 },
      uNormal: { value: new Vector3(0, 0, 1) },
      uParentRadiusKm: { value: opts.parentRadiusKm },
      uBodyScale: { value: 1 },
      uSatExponent: { value: 1 },
      uSatKnee: { value: 3 },
      uScaleBlend: { value: 0 },
      uSceneUnitKm: { value: 1000 },
    },
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
  });
}
