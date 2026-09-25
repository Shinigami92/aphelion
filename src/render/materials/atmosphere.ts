/** Atmospheres, as a single-scattering integration marched in the fragment shader. */

import { AdditiveBlending, FrontSide, ShaderMaterial, Vector3 } from 'three';
// oxlint-disable-next-line import/no-unassigned-import -- registers the <aphelion_ray_sphere> chunk the fragment shader includes
import './chunks.ts';
import atmosphereFragmentShader from '../shaders/atmosphere.frag.glsl?raw';
import atmosphereVertexShader from '../shaders/atmosphere.vert.glsl?raw';

export interface AtmosphereMaterialOptions {
  planetRadius: number;
  atmosphereRadius: number;
  rayleigh: [number, number, number];
  mie: number;
  density: number;
  /** View-ray march steps; 12 is plenty at these angular sizes. */
  steps?: number;
}

/**
 * Single-scattering haze shell.
 *
 * Every length in this shader is measured in **scale heights**, which is the
 * one decision the whole thing rests on. The integral used to accumulate
 * optical depth in scene units, so `density` meant nothing on its own: the same
 * body was optically thicker at explore scale than at true scale (its radius
 * changes by 6x), and the number could not be compared against anything
 * published. Dividing every path length by the scale height makes the integral
 * dimensionless, and `density` becomes exactly the atmosphere's **vertical
 * optical depth** — a quantity that is in the literature for all nine bodies
 * that have one, and that is identical in both scale modes.
 *
 * `uPlanetRadius` and `uAtmoRadius` must arrive in the body's *rendered* scene
 * units, matching the mesh. Passing the ratio instead of the radius is what
 * kept this shader from drawing a single pixel for its first several months.
 */
export function createAtmosphereMaterial(opts: AtmosphereMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    defines: { STEPS: opts.steps ?? 12, LIGHT_STEPS: 4 },
    transparent: true,
    depthWrite: false,
    // Flipped per frame by updateVisual: front faces while the camera is
    // outside, so the haze is depth-tested against anything in front of it;
    // back faces with the depth test off once the camera is inside the shell,
    // where the front faces are behind the eye and the planet would otherwise
    // reject every fragment.
    side: FrontSide,
    blending: AdditiveBlending,
    uniforms: {
      uCentre: { value: new Vector3() },
      uPlanetRadius: { value: opts.planetRadius },
      uAtmoRadius: { value: opts.atmosphereRadius },
      uPole: { value: new Vector3(0, 0, 1) },
      uSquash: { value: 1 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uSunIntensity: { value: 1 },
      uRayleigh: { value: new Vector3(...opts.rayleigh) },
      uMie: { value: opts.mie },
      uDensity: { value: opts.density },
    },
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
  });
}
