/** Orbit lines and the travel dust. */

import { AdditiveBlending, Color, ShaderMaterial, Vector3 } from 'three';
import dustFragmentShader from '../shaders/dust.frag.glsl?raw';
import dustVertexShader from '../shaders/dust.vert.glsl?raw';
import orbitFragmentShader from '../shaders/orbit.frag.glsl?raw';
import orbitVertexShader from '../shaders/orbit.vert.glsl?raw';

/**
 * Travel dust — short streaks that only exist while the camera is moving fast.
 *
 * The particles are a fixed cloud in a cube of one cell, wrapped modulo that
 * cube around the camera in the vertex shader. That makes the field effectively
 * infinite with no recycling pass on the CPU, and lets the cell resize with the
 * camera's speed so the same few hundred particles read correctly whether the
 * motion is kilometres or astronomical units per second.
 *
 * Each particle is a two-vertex segment whose tail is dragged *back along the
 * way it came*, which is +velocity in world terms: over the last frame the
 * camera advanced by `uStreak`, so where the particle appeared to be then is
 * where it is now plus that step. Dragging it the other way — the intuitive
 * reading, and what this did — points every streak at the destination and makes
 * the field read as flying the wrong way.
 *
 * **The cell must not be a smooth function of speed.** Particle positions are
 * `position * cell`, so resizing the cell drags the whole lattice through the
 * world: on the approach, where the flight decelerates and the cell shrinks
 * frame by frame, the drift measured 1.3-6.8x the camera's own motion and
 * pointed at the body being approached — the dust converged on the destination
 * instead of streaming past. So the lattice is quantised to powers of two,
 * which holds it perfectly still between steps, and two of them are kept a
 * factor of two apart and cross-faded: the one that has to jump when the step
 * comes is at zero weight exactly then, so the change is invisible.
 */
export function createDustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      // The camera position reduced modulo each cell, in double precision on the
      // CPU — the only form of it the shader ever sees. Passing it whole would
      // lose the wrap wherever the camera is many cells from the render origin,
      // a float32 coordinate there being coarser than a cell.
      uCamA: { value: new Vector3() },
      uCamB: { value: new Vector3() },
      uStreak: { value: new Vector3() },
      // One cell per cloud, an octave apart — which of the two is the coarser
      // alternates, so the caller owns the pairing. uBlend is cloud B's share.
      uCellA: { value: 1 },
      uCellB: { value: 2 },
      uBlend: { value: 0 },
      uIntensity: { value: 0 },
    },
    vertexShader: dustVertexShader,
    fragmentShader: dustFragmentShader,
  });
}

export function createOrbitMaterial(color: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      // Fades the trailing half of the orbit so the direction of travel reads.
      uHeadIndex: { value: 0 },
      uCount: { value: 1 },
      uTaper: { value: 0 },
    },
    vertexShader: orbitVertexShader,
    fragmentShader: orbitFragmentShader,
  });
}
