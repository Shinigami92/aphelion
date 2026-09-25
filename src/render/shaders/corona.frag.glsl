precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
uniform vec3 uCentre;
uniform float uInner;
uniform float uOuter;
varying vec3 vWorldPos;

#include <aphelion_ray_sphere>

#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  vec3 rd = normalize(vWorldPos - cameraPosition);
  // Impact parameter of the view ray against the Sun's centre.
  vec3 oc = cameraPosition - uCentre;
  float t = -dot(oc, rd);
  float b = length(oc + rd * t);

  float x = clamp((b - uInner) / (uOuter - uInner), 0.0, 1.0);
  // Coronal brightness falls off steeply; two lobes match it well enough.
  float glow = exp(-x * 5.5) * 0.75 + exp(-x * 1.6) * 0.25;
  if (b < uInner) glow = 1.0;

  gl_FragColor = vec4(uColor * glow * uIntensity, glow);
}
