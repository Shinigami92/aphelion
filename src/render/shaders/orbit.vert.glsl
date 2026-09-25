attribute float aIndex;
varying float vT;
// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vT = aIndex;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
