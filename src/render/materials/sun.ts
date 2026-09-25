/** The Sun and its corona. */

import { AdditiveBlending, BackSide, ShaderMaterial, Texture, Vector3 } from 'three';
import coronaFragmentShader from '../shaders/corona.frag.glsl?raw';
import coronaVertexShader from '../shaders/corona.vert.glsl?raw';
import sunFragmentShader from '../shaders/sun.frag.glsl?raw';
import sunVertexShader from '../shaders/sun.vert.glsl?raw';
import { prepare } from './chunks.ts';

export function createSunMaterial(map: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map ? prepare(map) : null },
      uHasMap: { value: map ? 1 : 0 },
      uTime: { value: 0 },
      uIntensity: { value: 6.0 },
    },
    vertexShader: sunVertexShader,
    fragmentShader: sunFragmentShader,
  });
}

/** Soft corona shell that fades outward; additive, drawn after the photosphere. */
export function createCoronaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Vector3(1.0, 0.72, 0.42) },
      uIntensity: { value: 1.0 },
      uCentre: { value: new Vector3() },
      uInner: { value: 1 },
      uOuter: { value: 2 },
    },
    vertexShader: coronaVertexShader,
    fragmentShader: coronaFragmentShader,
  });
}
