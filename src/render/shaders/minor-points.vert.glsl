attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vFade;
// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 1e-4);
  // aSize is 0 when the body has been promoted to a real mesh.
  gl_PointSize = aSize * clamp(uPixelRatio * 420.0 / dist, 1.2, 7.0);
  vFade = aSize * clamp(gl_PointSize / 2.0, 0.25, 1.0);
  #include <logdepthbuf_vertex>
}
