precision highp float;
uniform sampler2D uSprite;
uniform float uOpacity;
varying vec3 vColor;
varying float vFade;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  if (vFade <= 0.001) discard;
  float a = texture2D(uSprite, gl_PointCoord).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * vFade * uOpacity);
}
