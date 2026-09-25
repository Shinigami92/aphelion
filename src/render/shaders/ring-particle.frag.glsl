precision highp float;
uniform vec3 uSunPos;
uniform vec3 uPlanetCentre;
uniform float uPlanetRadius;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vTint;

#include <aphelion_color>
#include <aphelion_ray_sphere>
#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 N = normalize(vNormalW);

  // The planet's shadow falls across the particles exactly as it does
  // across the sheet, so flying into Saturn's shadow really does go dark.
  vec2 hit = raySphere(vWorldPos, L, uPlanetCentre, uPlanetRadius);
  float shadow = (hit.y >= hit.x && hit.x > 0.0) ? 0.06 : 1.0;

  float diffuse = 0.12 + 0.88 * max(dot(N, L), 0.0);
  vec3 albedo = srgbToLinear(vTint);
  gl_FragColor = vec4(albedo * diffuse * shadow, 1.0);
}
