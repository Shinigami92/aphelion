precision highp float;
uniform sampler2D uMap;
uniform float uBrightness;
varying vec2 vUv;
#include <aphelion_color>
void main() {
  vec3 c = srgbToLinear(texture2D(uMap, vUv).rgb);
  gl_FragColor = vec4(c * uBrightness, 1.0);
}
