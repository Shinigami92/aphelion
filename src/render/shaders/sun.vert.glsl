varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
