/** The surface of every sphere-rendered planet, moon and dwarf planet. */

import { Color, ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from 'three';
import bodyFragmentShader from '../shaders/body.frag.glsl?raw';
import bodyVertexShader from '../shaders/body.vert.glsl?raw';
import { prepare } from './chunks.ts';
import { MAX_OCCLUDERS } from './uniforms.ts';

export interface BodyMaterialOptions {
  map: Texture;
  nightMap?: Texture | null;
  normalMap?: Texture | null;
  specularMap?: Texture | null;
  /** Tint multiplied into the albedo. */
  tint?: number;
  /** Terminator/atmosphere rim colour; null disables the rim. */
  rimColor?: [number, number, number] | null;
  rimStrength?: number;
  /** Roughness for the specular lobe (only used where specularMap is set). */
  shininess?: number;
}

export function createBodyMaterial(opts: BodyMaterialOptions): ShaderMaterial {
  const uniforms = {
    uMap: { value: prepare(opts.map) },
    uNightMap: { value: opts.nightMap ? prepare(opts.nightMap) : null },
    uNormalMap: { value: opts.normalMap ? prepare(opts.normalMap) : null },
    uSpecularMap: { value: opts.specularMap ? prepare(opts.specularMap) : null },
    uHasNight: { value: opts.nightMap ? 1 : 0 },
    uHasNormal: { value: opts.normalMap ? 1 : 0 },
    uHasSpecular: { value: opts.specularMap ? 1 : 0 },
    uTint: { value: new Color(opts.tint ?? 0xffffff) },
    uSunPos: { value: new Vector3() },
    uSunRadius: { value: 1 },
    uSunIntensity: { value: 1 },
    // Eclipse geometry is evaluated in true kilometres relative to this body's
    // centre, so shadows stay exact even when explore mode has enlarged the
    // bodies and compressed the distances between them.
    uKmPerUnit: { value: 1 },
    uSunPosKm: { value: new Vector3(0, 0, 1.496e8) },
    uSunRadiusKm: { value: 695_700 },
    uOccluders: {
      value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4(0, 0, 0, 0)),
    },
    uRimColor: { value: new Vector3(...(opts.rimColor ?? [0, 0, 0])) },
    uRimStrength: { value: opts.rimColor ? (opts.rimStrength ?? 1) : 0 },
    uShininess: { value: opts.shininess ?? 60 },
    uAmbient: { value: 0.006 },
    ...ringShadowUniforms(),
    ...reliefUniforms(),
  };

  return new ShaderMaterial({
    defines: { MAX_OCCLUDERS },
    uniforms,
    vertexShader: bodyVertexShader,
    fragmentShader: bodyFragmentShader,
  });
}

/**
 * Ring shadow cast onto the planet. Bounds are in true kilometres, matching
 * the ring material, and the hit radius is converted back before lookup.
 */
function ringShadowUniforms() {
  return {
    uRingEnabled: { value: 0 },
    uRingTex: { value: null as Texture | null },
    uRingInnerKm: { value: 0 },
    uRingOuterKm: { value: 1 },
    uRingOpacity: { value: 1 },
    uRingNormal: { value: new Vector3(0, 0, 1) },
    uBodyCentre: { value: new Vector3() },
    uParentRadiusKm: { value: 1 },
    uBodyScale: { value: 1 },
    uSatExponent: { value: 1 },
    uSatKnee: { value: 3 },
    uScaleBlend: { value: 0 },
    uSceneUnitKm: { value: 1000 },
  };
}

/**
 * Relief displacement. Off for every body without a published elevation
 * grid, which is most of them.
 */
function reliefUniforms() {
  return {
    uRelief: { value: null as Texture | null },
    uHasRelief: { value: 0 },
    uReliefMinKm: { value: 0 },
    uReliefSpanKm: { value: 0 },
    /** Model-space displacement per km of elevation, exaggeration included. */
    uReliefScale: { value: 0 },
    /** uv spacing of the drawn LOD's vertices, for the differenced normal. */
    uReliefStep: { value: new Vector2(1, 1) },
  };
}
