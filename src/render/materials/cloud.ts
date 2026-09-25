/** The cloud shell of Earth and Venus, sheared by a zonal wind profile. */

import { ShaderMaterial, Texture, Vector3, Vector4 } from 'three';
import cloudFragmentShader from '../shaders/cloud.frag.glsl?raw';
import cloudVertexShader from '../shaders/cloud.vert.glsl?raw';
import { prepare } from './chunks.ts';
import { MAX_OCCLUDERS } from './uniforms.ts';

/**
 * Latitude samples in the zonal wind profile — 19, one every 10 degrees, index
 * 0 at the south pole. See `BodySpec.cloudWindMs`.
 */
export const ZONAL_SAMPLES = 19;

export function createCloudMaterial(map: Texture, opts: { opacity?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    defines: { MAX_OCCLUDERS, ZONAL_SAMPLES },
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      // Angular form of the wind profile: degrees of longitude per day at each
      // sampled latitude. Filled in by the renderer, which is where the body's
      // radius lives. Zero everywhere means a deck that does not shear.
      uZonalDeg: { value: Array.from({ length: ZONAL_SAMPLES }, () => 0) },
      uHasFlow: { value: 0 },
      // Two ages, in days, and the weight of the second. See the fragment
      // shader for why there are two.
      uPhaseA: { value: 0 },
      uPhaseB: { value: 0 },
      uBlend: { value: 0 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uOpacity: { value: opts.opacity ?? 1 },
      uKmPerUnit: { value: 1 },
      uSunPosKm: { value: new Vector3(0, 0, 1.496e8) },
      uSunRadiusKm: { value: 695_700 },
      uBodyCentre: { value: new Vector3() },
      uOccluders: {
        value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4(0, 0, 0, 0)),
      },
    },
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
  });
}
