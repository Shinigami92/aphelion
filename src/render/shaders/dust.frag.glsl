precision highp float;
varying float vFade;

#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  if (vFade <= 0.001) discard;
  gl_FragColor = vec4(vec3(0.62, 0.72, 0.9), vFade * 0.5);
}
