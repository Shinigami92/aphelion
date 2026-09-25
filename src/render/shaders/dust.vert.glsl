attribute float aEnd;
attribute float aLattice;
varying float vFade;

uniform vec3 uCamA;
uniform vec3 uCamB;
uniform vec3 uStreak;
uniform float uCellA;
uniform float uCellB;
uniform float uBlend;
uniform float uIntensity;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  float cell = mix(uCellA, uCellB, aLattice);
  vec3 camMod = mix(uCamA, uCamB, aLattice);
  float weight = mix(1.0 - uBlend, uBlend, aLattice);

  // Wrap the particle into the cell centred on the camera. Without the
  // half-cell shift the modulo folds at the camera itself, and the dust
  // visibly pops as it crosses the eye.
  vec3 rel = mod(position * cell - camMod + 0.5 * cell, cell) - 0.5 * cell;

  // Fade with distance from the camera, so particles arrive and leave
  // rather than blinking into existence at the cell boundary.
  float d = length(rel) / (0.5 * cell);
  vFade = uIntensity * weight * smoothstep(1.0, 0.55, d) * (1.0 - aEnd * 0.75);

  // Placed as an offset from the eye, never as an absolute position. The
  // camera sits at the origin of view space, so rotating the offset is the
  // whole transform — and the field is still anchored in the world, since
  // the wrap above pins it to the lattice. Building a world position first
  // would mean adding a number the size of the solar system to one the size
  // of a cell, in float32, at the far end of a flight: the field would land
  // on a grid coarser than a frame's travel and jitter as the eye moved.
  gl_Position = projectionMatrix
    * vec4(mat3(viewMatrix) * (rel + uStreak * aEnd), 1.0);
  #include <logdepthbuf_vertex>
}
