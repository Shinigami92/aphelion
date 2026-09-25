attribute vec3 aColor;
attribute float aFade;
uniform float uPixelRatio;
uniform float uSize;
varying vec3 vColor;
varying float vFade;
// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vColor = aColor;
  vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio;
  #include <logdepthbuf_vertex>
}
