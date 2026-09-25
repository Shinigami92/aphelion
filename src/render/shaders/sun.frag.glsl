precision highp float;
uniform sampler2D uMap;
uniform int uHasMap;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

#include <aphelion_color>

#include <logdepthbuf_pars_fragment>

// Cheap hash noise for the granulation shimmer.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 base = uHasMap == 1
    ? srgbToLinear(texture2D(uMap, vUv).rgb)
    : vec3(1.0, 0.72, 0.38);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Granulation: slowly evolving cellular brightness.
  vec3 q = N * 26.0;
  float gran = noise(q + vec3(0.0, 0.0, uTime * 0.06));
  gran = mix(gran, noise(q * 2.7 - vec3(uTime * 0.04)), 0.45);

  // Limb darkening, I(mu) = 1 - u(1 - mu), u ~ 0.62 in the visible.
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float limb = 1.0 - 0.62 * (1.0 - mu);

  vec3 colour = base * (0.82 + gran * 0.42) * limb * uIntensity;

  // Hot rim just inside the limb, where we look through more photosphere.
  colour += vec3(1.0, 0.55, 0.2) * pow(1.0 - mu, 3.5) * 1.5;

  gl_FragColor = vec4(colour, 1.0);
}
