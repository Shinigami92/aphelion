precision highp float;
uniform float uOpacity;
varying vec3 vColor;
varying float vSharpness;

const float BETA = 2.5;

void main() {
  // Distance from the centre in units of the sprite's own radius, so the
  // profile reaches the same value at the rim for every star.
  float d = 2.0 * length(gl_PointCoord - 0.5);
  if (d > 1.0) discard;
  float profile = pow(1.0 + vSharpness * d * d, -BETA);
  gl_FragColor = vec4(vColor * profile * uOpacity, 1.0);
}
