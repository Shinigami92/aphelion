precision highp float;
uniform sampler2D uTex;
uniform float uInnerKm;
uniform float uOuterKm;
uniform float uOpacity;
uniform float uExploreBoost;
uniform float uExploreBrightness;
uniform float uScaleBlend;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform vec3 uPlanetCentre;
uniform float uPlanetRadius;
uniform vec3 uNormal;
varying vec3 vWorldPos;
varying float vRingKm;

#include <aphelion_color>
#include <aphelion_ray_sphere>

#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>

  // Radial coordinate across the annulus, in kilometres. Looking the
  // profile up by true radius rather than by rendered radius is what
  // keeps a gap at the kilometre it belongs to in either scale model.
  float u = (vRingKm - uInnerKm) / (uOuterKm - uInnerKm);
  if (u < 0.0 || u > 1.0) discard;

  vec4 tex = texture2D(uTex, vec2(u, 0.5));
  // The boost is 1 at true scale and only rises as explore scale blends
  // in, so nothing here is ever brighter than the physics in the mode
  // that claims to be literal.
  float alpha = tex.a * uOpacity * mix(1.0, uExploreBoost, uScaleBlend);
  if (alpha < 0.004) discard;

  vec3 albedo = srgbToLinear(tex.rgb);

  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(uNormal);

  // The planet's shadow falling across the rings.
  vec2 hit = raySphere(vWorldPos, L, uPlanetCentre, uPlanetRadius);
  float shadow = (hit.y >= hit.x && hit.x > 0.0) ? 0.06 : 1.0;

  float sunSide = dot(N, L);
  float viewSide = dot(N, V);

  // Particles are lit from one face. Looking at the sunlit face you see
  // reflected light; from the other side you see the much dimmer light
  // transmitted through the ring plane.
  float mu = abs(sunSide);
  float reflected = 0.22 + 0.78 * mu;
  bool sameSide = sunSide * viewSide > 0.0;
  float brightness = sameSide ? reflected : reflected * 0.28;

  // Grazing views pile up optical depth.
  float grazing = clamp(abs(viewSide), 0.06, 1.0);
  alpha = clamp(alpha / grazing * mix(1.0, 0.55, step(abs(viewSide), 0.12)), 0.0, 1.0);

  vec3 colour = albedo * brightness * shadow * mix(1.0, uExploreBrightness, uScaleBlend);
  gl_FragColor = vec4(colour, alpha);
}
