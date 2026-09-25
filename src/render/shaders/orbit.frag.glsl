precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHeadIndex;
uniform float uCount;
uniform float uTaper;
varying float vT;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float alpha = uOpacity;
  if (uTaper > 0.5) {
    // Distance behind the body, normalised to one revolution.
    float d = mod(uHeadIndex - vT + uCount, uCount) / uCount;
    alpha *= mix(1.0, 0.05, smoothstep(0.0, 0.75, d));
  }
  gl_FragColor = vec4(uColor, alpha);
}
