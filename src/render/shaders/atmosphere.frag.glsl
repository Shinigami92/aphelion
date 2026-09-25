precision highp float;

uniform vec3 uCentre;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform vec3 uPole;
uniform float uSquash;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform float uSunIntensity;
uniform vec3 uRayleigh;
uniform float uMie;
uniform float uDensity;

varying vec3 vWorldPos;

#include <aphelion_ray_sphere>

#include <logdepthbuf_pars_fragment>


// A white Lambertian surface facing the Sun renders as 1.0 in this
// pipeline (createBodyMaterial: albedo * diffuse * uSunIntensity), so one
// output unit is an irradiance of pi. Both phase functions below are
// normalised to integrate to 1 over the sphere, which means the
// single-scattering radiance needs that same pi to land in the renderer's
// units. It is the only gain in the shader: the 22.0 and 14.0 that used
// to sit here were compensating for the scene-unit path lengths.
const float RADIANCE_TO_UNITS = 3.14159265;

/**
 * Stretch along the pole so an oblate body becomes a sphere.
 *
 * Saturn is flattened by 1/10 and Jupiter by 1/15. Marching them as
 * spheres puts the analytic surface proud of the drawn mesh at the poles,
 * which shows up as a dark collar between the visible pole and the point
 * where the haze starts — the shell's radius is equatorial everywhere.
 * The map is affine, so rays stay straight and every intersection below is
 * still a plain ray-sphere test. Path lengths stretch by up to 1/uSquash
 * along the pole (11% at Saturn), which is far inside the tolerance of a
 * haze described by one number per body. It also puts the isopycnic
 * surfaces on spheroids rather than spheres, which is what a rotating
 * atmosphere actually does.
 */
vec3 toSphere(vec3 v) {
  return v + uPole * dot(v, uPole) * (1.0 / uSquash - 1.0);
}

// Scale height of the visible haze. The shell is five of them.
float scaleHeight() {
  return max((uAtmoRadius - uPlanetRadius) / 5.0, 1e-9);
}

// Density relative to ground level, at a point measured from the centre.
//
// The exponential is offset so it reaches exactly zero at the top of the
// shell instead of being truncated at exp(-5). Five scale heights up the
// air is still 0.67% of ground density, and a grazing ray crosses a long
// chord of it, so cutting it off draws a hard-edged disc around the body —
// very visible on Titan, whose shell is 23% of its radius. Costs 0.7% of
// the column and buys a haze that fades into space.
float densityAt(vec3 p) {
  const float EDGE = 0.006737947;   // exp(-5)
  float d = exp(-max(length(p) - uPlanetRadius, 0.0) / scaleHeight());
  return max(d - EDGE, 0.0) / (1.0 - EDGE);
}

// Air mass from a point toward the Sun, in scale heights. Dimensionless:
// multiply by a vertical optical depth to get an optical depth.
float lightAirMass(vec3 p, vec3 L) {
  vec2 hit = raySphere(p, L, vec3(0.0), uAtmoRadius);
  if (hit.y < hit.x) return 0.0;
  float stepLen = max(hit.y, 0.0) / float(LIGHT_STEPS);
  float total = 0.0;
  vec3 pos = p + L * stepLen * 0.5;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    total += densityAt(pos) * stepLen;
    pos += L * stepLen;
  }
  return total / scaleHeight();
}

void main() {
  #include <logdepthbuf_fragment>

  // The march runs in the space where the body is a sphere at the origin.
  vec3 rdWorld = normalize(vWorldPos - cameraPosition);
  vec3 ro = toSphere(cameraPosition - uCentre);
  vec3 rd = normalize(toSphere(rdWorld));

  vec2 atmo = raySphere(ro, rd, vec3(0.0), uAtmoRadius);
  if (atmo.y < atmo.x) discard;

  float tNear = max(atmo.x, 0.0);
  float tFar = atmo.y;

  // Stop at the planet's surface if the ray hits it.
  vec2 solid = raySphere(ro, rd, vec3(0.0), uPlanetRadius);
  if (solid.y >= solid.x && solid.y > 0.0) tFar = min(tFar, max(solid.x, 0.0));
  if (tFar <= tNear) discard;

  vec3 sunPos = toSphere(uSunPos - uCentre);

  float stepLen = (tFar - tNear) / float(STEPS);
  float stepH = stepLen / scaleHeight();

  // Per-channel vertical optical depth: the tint sets what is scattered
  // out of the beam, plus a grey aerosol term.
  vec3 tauVertical = uDensity * (uRayleigh + vec3(uMie));

  // The haze colour, normalised. The aerosol in-scatter is tinted with it
  // rather than left grey, and Titan is the reason. Its Mie term is 1.2
  // against a Rayleigh tint of 0.95, and at the high phase angles where a
  // haze is worth looking at the Cornette-Shanks lobe reaches 2.8 against
  // Rayleigh's 0.12 — so a grey aerosol term buries the tint about 30 to 1
  // and the only colour left is the *extinction*, which favours whatever
  // the tint scatters least. That renders Titan pale blue-grey: exactly
  // inverted. Real tholin haze scatters with a strong colour of its own.
  vec3 hazeTint = uRayleigh / max(max(uRayleigh.r, max(uRayleigh.g, uRayleigh.b)), 1e-4);

  vec3 inscatter = vec3(0.0);
  float airMass = 0.0;
  vec3 pos = ro + rd * (tNear + stepLen * 0.5);

  for (int i = 0; i < STEPS; i++) {
    float d = densityAt(pos);
    airMass += d * stepH;

    vec3 toSun = sunPos - pos;
    float sunDist = length(toSun);
    vec3 L = toSun / sunDist;

    // Soft planet shadow: the penumbra is the Sun's angular radius
    // carried over the distance from the sample to its closest approach
    // to the axis, so the haze fades into the shadow instead of ending on
    // a hard rim. A hard test is what makes a terminator look stamped on.
    float along = dot(-pos, L);
    float perp = sqrt(max(dot(pos, pos) - along * along, 0.0));
    float penumbra = max(uSunRadius / sunDist * max(along, 0.0), uPlanetRadius * 1e-3);
    float lit = along > 0.0
      ? smoothstep(uPlanetRadius - penumbra, uPlanetRadius + penumbra, perp)
      : 1.0;

    if (lit > 0.0) {
      inscatter += d * stepH * lit * exp(-tauVertical * (airMass + lightAirMass(pos, L)));
    }
    pos += rd * stepLen;
  }

  // Phase angle comes from the true world geometry, not the skewed space.
  float mu = dot(rdWorld, normalize(uSunPos - cameraPosition));
  float phaseR = 0.0596831 * (1.0 + mu * mu);
  // Cornette-Shanks, g = 0.76: the forward lobe that lights Pluto's haze
  // from behind and hazes Titan's crescent.
  const float g = 0.76;
  const float g2 = g * g;
  float phaseM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu))
               / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));

  vec3 colour = inscatter * uDensity * (uRayleigh * phaseR + hazeTint * uMie * phaseM)
              * uSunIntensity * RADIANCE_TO_UNITS;

  gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
}
