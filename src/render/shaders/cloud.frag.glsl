precision highp float;
uniform sampler2D uMap;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform float uOpacity;
uniform float uKmPerUnit;
uniform vec3 uSunPosKm;
uniform float uSunRadiusKm;
uniform vec3 uBodyCentre;
uniform vec4 uOccluders[MAX_OCCLUDERS];
uniform float uZonalDeg[ZONAL_SAMPLES];
uniform float uHasFlow;
uniform float uPhaseA;
uniform float uPhaseB;
uniform float uBlend;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

#include <aphelion_color>
#include <aphelion_eclipse>

#include <logdepthbuf_pars_fragment>

/** Wind at this latitude, interpolated between the profile's samples. */
float zonalRate(float v) {
  // v runs 0 at the north pole to 1 at the south — see createSphere() —
  // while the profile is indexed from the south, so latitude is the only
  // honest way to address it.
  float lat = 90.0 - v * 180.0;
  float t = (lat + 90.0) / 180.0 * float(ZONAL_SAMPLES - 1);
  float i = floor(t);
  int lo = int(clamp(i, 0.0, float(ZONAL_SAMPLES - 2)));
  return mix(uZonalDeg[lo], uZonalDeg[lo + 1], clamp(t - i, 0.0, 1.0));
}

void main() {
  #include <logdepthbuf_fragment>
  vec4 tex;
  if (uHasFlow > 0.5) {
    // Advect the deck in longitude at the local wind speed. Reading the
    // map *west* of a fragment puts what used to be west of it here, so
    // the cloud moves east: the minus is the whole direction of the wind
    // and flipping it drives the jets backwards.
    //
    // Two copies, half a period out of step, because a shear that only
    // accumulates tears a fixed snapshot into longitudinal stripes within
    // a sim-week. Each copy's age runs -T/2 to +T/2 and wraps, and the
    // weights are arranged so a copy is at full strength exactly when its
    // age is zero and invisible when it wraps — so the reset never pops.
    // The price is honest and unavoidable: apparent flow without net
    // transport, so a storm shears in place rather than crossing an
    // ocean.
    float rate = zonalRate(vUv.y);
    vec4 a = texture2D(uMap, vec2(vUv.x - rate * uPhaseA / 360.0, vUv.y));
    vec4 b = texture2D(uMap, vec2(vUv.x - rate * uPhaseB / 360.0, vUv.y));
    tex = mix(a, b, uBlend);
  } else {
    tex = texture2D(uMap, vUv);
  }
  // The cloud maps encode cover as brightness on black.
  float cover = max(tex.r, max(tex.g, tex.b));
  if (cover < 0.02) discard;

  vec3 N = normalize(vNormal);
  vec3 toSun = uSunPos - vWorldPos;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  float sunAng = uSunRadius / dSun;
  float diffuse = clamp((dot(N, L) + sunAng) / (1.0 + sunAng), 0.0, 1.0);
  vec3 posKm = (vWorldPos - uBodyCentre) * uKmPerUnit;
  float eclipse = eclipseFactor(posKm, uSunPosKm, uSunRadiusKm, uOccluders);

  vec3 col = srgbToLinear(vec3(cover)) * diffuse * eclipse;
  gl_FragColor = vec4(col, cover * uOpacity);
}
