precision highp float;

uniform sampler2D uMap;
uniform sampler2D uNightMap;
uniform sampler2D uNormalMap;
uniform sampler2D uSpecularMap;
uniform int uHasNight;
uniform int uHasNormal;
uniform int uHasSpecular;
uniform vec3 uTint;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform float uSunIntensity;
uniform float uKmPerUnit;
uniform vec3 uSunPosKm;
uniform float uSunRadiusKm;
uniform vec4 uOccluders[MAX_OCCLUDERS];
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uShininess;
uniform float uAmbient;

uniform int uRingEnabled;
uniform sampler2D uRingTex;
uniform float uRingInnerKm;
uniform float uRingOuterKm;
uniform float uRingOpacity;
uniform vec3 uRingNormal;
uniform vec3 uBodyCentre;
#include <aphelion_ring_scale_pars>

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

#include <aphelion_color>
#include <aphelion_eclipse>
#include <aphelion_ring_to_km>

#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>

  vec3 albedo = srgbToLinear(texture2D(uMap, vUv).rgb) * uTint;

  vec3 N = normalize(vNormal);

  // Tangent-space normal mapping using the frame built in the vertex
  // stage: x = east, y = north, z = surface normal.
  if (uHasNormal == 1) {
    mat3 tbn = mat3(normalize(vTangent), normalize(vBitangent), N);
    vec3 nm = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    nm.xy *= 1.15;
    N = normalize(tbn * normalize(nm));
  }

  vec3 toSun = uSunPos - vWorldPos;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Wrapped diffuse: the Sun is a disc, not a point, so the terminator has
  // a real angular width that grows as you move outward.
  float sunAng = uSunRadius / dSun;
  float ndl = dot(N, L);
  float diffuse = clamp((ndl + sunAng) / (1.0 + sunAng), 0.0, 1.0);

  // Convert this surface point into body-centred kilometres. The body is
  // uniformly scaled, so one factor suffices.
  vec3 posKm = (vWorldPos - uBodyCentre) * uKmPerUnit;
  float eclipse = eclipseFactor(posKm, uSunPosKm, uSunRadiusKm, uOccluders);

  // Ring shadow: march from the surface toward the Sun and see whether it
  // crosses the ring plane inside the annulus. The hit arrives as a
  // rendered radius, so it goes back through the remap into kilometres
  // before the profile is sampled — otherwise the shadow's gaps would sit
  // at different radii from the gaps casting them.
  float ringShadow = 1.0;
  if (uRingEnabled == 1) {
    float denom = dot(L, uRingNormal);
    if (abs(denom) > 1e-6) {
      float t = dot(uBodyCentre - vWorldPos, uRingNormal) / denom;
      if (t > 0.0) {
        vec3 hit = vWorldPos + L * t;
        float km = ringUnitsToKm(length(hit - uBodyCentre));
        if (km > uRingInnerKm && km < uRingOuterKm) {
          float u = (km - uRingInnerKm) / (uRingOuterKm - uRingInnerKm);
          // Scaled by the ring's own opacity: the texture alpha is a
          // profile shape, not an absolute optical depth, so reading it
          // raw made Jupiter's Halo (opacity 0.035) shadow the planet as
          // hard as Saturn's B ring.
          float opacity = texture2D(uRingTex, vec2(u, 0.5)).a * uRingOpacity;
          ringShadow = 1.0 - clamp(opacity, 0.0, 1.0) * 0.85;
        }
      }
    }
  }

  float shadow = eclipse * ringShadow;
  vec3 lit = albedo * diffuse * shadow * uSunIntensity;

  // Specular highlight, masked to water/ice where a map is available.
  if (uHasSpecular == 1) {
    float mask = texture2D(uSpecularMap, vUv).r;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess);
    lit += vec3(1.0, 0.98, 0.92) * spec * mask * 1.4 * diffuse * shadow;
  }

  // City lights on the unlit hemisphere.
  if (uHasNight == 1) {
    float night = 1.0 - clamp((ndl + 0.08) / 0.18, 0.0, 1.0);
    vec3 lights = srgbToLinear(texture2D(uNightMap, vUv).rgb);
    // Dim the lights where the Moon's shadow falls: an eclipse does not
    // switch the grid on.
    lit += lights * night * 1.35 * mix(0.35, 1.0, 1.0 - eclipse * 0.0 + 0.0);
  }

  // Atmospheric rim: a thin warm band right at the terminator plus a cool
  // limb glow, which is what sells a planet with air from a distance.
  if (uRimStrength > 0.0) {
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    float terminator = exp(-pow(abs(ndl) * 7.0, 2.0));
    lit += uRimColor * fres * (0.35 + terminator * 1.4) * uRimStrength * diffuse * shadow;
  }

  lit += albedo * uAmbient;

  gl_FragColor = vec4(lit, 1.0);
}
