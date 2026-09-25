// The annulus is built in true kilometres: position carries only the
// unit direction in the ring plane and aRingKm the real radius, so the
// one geometry serves both scale models and the profile stays registered
// to kilometres however the radial remap stretches it.
attribute float aRingKm;
varying vec3 vWorldPos;
varying float vRingKm;
#include <aphelion_ring_scale_pars>
// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>
#include <aphelion_ring_to_units>
void main() {
  vRingKm = aRingKm;
  vec3 local = vec3(position.xy * ringRadiusToUnits(aRingKm), position.z);
  vec4 world = modelMatrix * vec4(local, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
