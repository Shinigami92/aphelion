/**
 * Shaders.
 *
 * Everything here works in "render space": scene units (1 = 1000 km) offset by
 * the floating origin, so coordinates near the camera stay small enough for
 * float32. Every material receives the Sun's position in the same space.
 *
 * The physically interesting parts:
 *
 *   - Solar eclipses are computed analytically. Each body is handed up to four
 *     occluders and works out what fraction of the Sun's *disc* they cover, so
 *     you get real penumbras: the Moon's shadow sweeping across Earth, Io's dot
 *     crossing Jupiter, Earth's shadow reddening the Moon.
 *   - Saturn's rings shadow the planet and the planet shadows the rings, both
 *     by ray-plane and ray-sphere tests rather than shadow maps (which cannot
 *     span these distances).
 *   - Atmospheres are single-scattering integrations with Rayleigh and Mie
 *     terms, marched in the fragment shader. That is what produces the blue
 *     limb, the reddened terminator and the correct forward-scattering haze
 *     when you look toward the Sun through the atmosphere.
 */

import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from 'three'

/** Maximum simultaneous eclipse occluders per body. */
export const MAX_OCCLUDERS = 4

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

/**
 * sRGB decode. We deliberately mark every texture as linear so Three.js does
 * not inject its own conversion into these custom shaders, then decode here.
 * That keeps the colour pipeline explicit instead of depending on which
 * material type is in use.
 */
const GLSL_COLOR = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`

/**
 * Fraction of a disc of angular radius `rSun` hidden behind a disc of angular
 * radius `rOcc` whose centre is `sep` radians away. Exact circle-circle lens
 * area, which is what makes annular versus total eclipses come out right.
 */
const GLSL_ECLIPSE = /* glsl */ `
float discOverlap(float rSun, float rOcc, float sep) {
  if (sep >= rSun + rOcc) return 0.0;
  if (sep <= rOcc - rSun) return 1.0;                       // total
  if (sep <= rSun - rOcc) return (rOcc * rOcc) / (rSun * rSun); // annular
  float d = max(sep, 1e-7);
  float r = rSun;
  float R = rOcc;
  float d1 = (d * d + r * r - R * R) / (2.0 * d);
  float d2 = d - d1;
  float a1 = r * r * acos(clamp(d1 / r, -1.0, 1.0)) - d1 * sqrt(max(0.0, r * r - d1 * d1));
  float a2 = R * R * acos(clamp(d2 / R, -1.0, 1.0)) - d2 * sqrt(max(0.0, R * R - d2 * d2));
  return clamp((a1 + a2) / (3.14159265 * r * r), 0.0, 1.0);
}

// occluders: xyz = centre in render space, w = radius (0 disables the slot)
float eclipseFactor(vec3 P, vec3 sunPos, float sunRadius, vec4 occ[${MAX_OCCLUDERS}]) {
  vec3 toSun = sunPos - P;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  float rSun = asin(clamp(sunRadius / dSun, 0.0, 1.0));

  float blocked = 0.0;
  for (int i = 0; i < ${MAX_OCCLUDERS}; i++) {
    float radius = occ[i].w;
    if (radius <= 0.0) continue;
    vec3 toOcc = occ[i].xyz - P;
    float dOcc = length(toOcc);
    if (dOcc < 1e-6 || dOcc > dSun) continue;      // behind us or past the Sun
    vec3 D = toOcc / dOcc;
    float cosSep = dot(D, L);
    if (cosSep <= 0.0) continue;                   // on the far side
    float rOcc = asin(clamp(radius / dOcc, 0.0, 1.0));
    float sep = acos(clamp(cosSep, -1.0, 1.0));
    blocked += discOverlap(rSun, rOcc, sep);
  }
  return clamp(1.0 - blocked, 0.0, 1.0);
}
`

/** Ray-sphere intersection; returns (near, far) or (1, -1) when missed. */
const GLSL_RAY_SPHERE = /* glsl */ `
vec2 raySphere(vec3 origin, vec3 dir, vec3 centre, float radius) {
  vec3 oc = origin - centre;
  float b = dot(oc, dir);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
`

/**
 * The uniforms describing the radial remap a ring shares with the moons.
 *
 * A ring is not a decal painted on the planet at some multiple of its radius:
 * it is a population of orbiting bodies, and it has to be remapped as one. Pan
 * orbits *inside* the Encke gap and Daphnis inside the Keeler gap; Prometheus
 * and Pandora straddle the F ring and hold it in place. Scaling rings linearly
 * with the body while scaling moon orbits by the satellite power law drove the
 * two apart by more than 200 scene units at Saturn, which put Pan in the middle
 * of the B ring and left Mimas embedded in the ring sheet. Sending both through
 * the same law puts every shepherd back in its own gap for nothing.
 */
const GLSL_RING_SCALE_PARS = /* glsl */ `
uniform float uParentRadiusKm;
uniform float uBodyScale;
uniform float uSatExponent;
uniform float uSatKnee;
uniform float uScaleBlend;
uniform float uSceneUnitKm;
`

/** Mirror of `ScaleModel.satelliteDistance()`. Keep the two in lockstep. */
const GLSL_RING_TO_UNITS = /* glsl */ `
float ringRadiusToUnits(float km) {
  float x = max(km, 1.0) / uParentRadiusKm;
  float shaped = x <= uSatKnee ? x : uSatKnee * pow(x / uSatKnee, uSatExponent);
  float compressed = uParentRadiusKm * uBodyScale * shaped;
  return mix(km, compressed, uScaleBlend) / uSceneUnitKm;
}
`

/**
 * The inverse, for code that starts from a rendered radius — the ring shadow
 * cast on the planet, which gets its radius from a ray-plane hit rather than
 * from a vertex.
 *
 * Exact at both ends of the scale blend, which is where the camera actually
 * sits; the two laws are mixed rather than the equation being inverted, since
 * a partly-blended power law has no closed-form inverse. The error only exists
 * during the ~0.6 s of a scale transition and only moves the shadow's edge.
 */
const GLSL_RING_TO_KM = /* glsl */ `
float ringUnitsToKm(float units) {
  float km = units * uSceneUnitKm;
  float shaped = km / (uParentRadiusKm * uBodyScale);
  float x = shaped <= uSatKnee ? shaped : uSatKnee * pow(shaped / uSatKnee, 1.0 / uSatExponent);
  return mix(km, x * uParentRadiusKm, uScaleBlend);
}
`

// ---------------------------------------------------------------------------
// Body (planet / moon / dwarf) surface
// ---------------------------------------------------------------------------

export interface BodyMaterialOptions {
  map: Texture
  nightMap?: Texture | null
  normalMap?: Texture | null
  specularMap?: Texture | null
  /** Tint multiplied into the albedo. */
  tint?: number
  /** Terminator/atmosphere rim colour; null disables the rim. */
  rimColor?: [number, number, number] | null
  rimStrength?: number
  /** Roughness for the specular lobe (only used where specularMap is set). */
  shininess?: number
}

export function createBodyMaterial(opts: BodyMaterialOptions): ShaderMaterial {
  const uniforms = {
    uMap: { value: prepare(opts.map) },
    uNightMap: { value: opts.nightMap ? prepare(opts.nightMap) : null },
    uNormalMap: { value: opts.normalMap ? prepare(opts.normalMap) : null },
    uSpecularMap: { value: opts.specularMap ? prepare(opts.specularMap) : null },
    uHasNight: { value: opts.nightMap ? 1 : 0 },
    uHasNormal: { value: opts.normalMap ? 1 : 0 },
    uHasSpecular: { value: opts.specularMap ? 1 : 0 },
    uTint: { value: new Color(opts.tint ?? 0xffffff) },
    uSunPos: { value: new Vector3() },
    uSunRadius: { value: 1 },
    uSunIntensity: { value: 1 },
    // Eclipse geometry is evaluated in true kilometres relative to this body's
    // centre, so shadows stay exact even when explore mode has enlarged the
    // bodies and compressed the distances between them.
    uKmPerUnit: { value: 1 },
    uSunPosKm: { value: new Vector3(0, 0, 1.496e8) },
    uSunRadiusKm: { value: 695_700 },
    uOccluders: {
      value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4(0, 0, 0, 0)),
    },
    uRimColor: { value: new Vector3(...(opts.rimColor ?? [0, 0, 0])) },
    uRimStrength: { value: opts.rimColor ? (opts.rimStrength ?? 1) : 0 },
    uShininess: { value: opts.shininess ?? 60 },
    uAmbient: { value: 0.006 },
    // Ring shadow cast onto the planet. Bounds are in true kilometres, matching
    // the ring material, and the hit radius is converted back before lookup.
    uRingEnabled: { value: 0 },
    uRingTex: { value: null as Texture | null },
    uRingInnerKm: { value: 0 },
    uRingOuterKm: { value: 1 },
    uRingOpacity: { value: 1 },
    uRingNormal: { value: new Vector3(0, 0, 1) },
    uBodyCentre: { value: new Vector3() },
    uParentRadiusKm: { value: 1 },
    uBodyScale: { value: 1 },
    uSatExponent: { value: 1 },
    uSatKnee: { value: 3 },
    uScaleBlend: { value: 0 },
    uSceneUnitKm: { value: 1000 },
    // Relief displacement. Off for every body without a published elevation
    // grid, which is most of them.
    uRelief: { value: null as Texture | null },
    uHasRelief: { value: 0 },
    uReliefMinKm: { value: 0 },
    uReliefSpanKm: { value: 0 },
    /** Model-space displacement per km of elevation, exaggeration included. */
    uReliefScale: { value: 0 },
    /** uv spacing of the drawn LOD's vertices, for the differenced normal. */
    uReliefStep: { value: new Vector2(1, 1) },
  }

  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vTangent;
      varying vec3 vBitangent;

      uniform sampler2D uRelief;
      uniform int uHasRelief;
      uniform float uReliefMinKm;
      uniform float uReliefSpanKm;
      uniform float uReliefScale;
      uniform vec2 uReliefStep;

      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>

      /**
       * Elevation at a uv, as a model-space displacement.
       *
       * The map stores a 16-bit fraction split across red (high byte) and green
       * (low byte), because browsers decode 16-bit PNGs to 8 bits and one part
       * in 255 of Mars's 29 km range is a 115 m step — invisible as an altitude,
       * glaring as a terrace in the normals.
       */
      float reliefAt(vec2 uv) {
        vec3 t = texture2D(uRelief, uv).rgb;
        float f = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0;
        return (uReliefMinKm + f * uReliefSpanKm) * uReliefScale;
      }

      /** The unit-sphere point a uv came from; inverse of createSphere(). */
      vec3 sphereAt(vec2 uv) {
        float lon = (uv.x - 0.5) * 6.283185307179586;
        float theta = uv.y * 3.141592653589793;
        float s = sin(theta);
        return vec3(s * cos(lon), s * sin(lon), cos(theta));
      }

      void main() {
        vUv = uv;
        mat3 normalToWorld = mat3(modelMatrix);

        // Tangent frame from the sphere's own parameterisation: +u runs east
        // along a parallel, and cross(n, T) then points north. Built from the
        // undisplaced normal, because that is the frame normal maps are authored
        // in. Built here because modelMatrix does not exist in the fragment stage.
        vec3 T = normalize(vec3(-normal.y, normal.x, 0.0) + vec3(1e-6, 0.0, 0.0));
        vec3 B = cross(normal, T);
        vTangent = normalize(normalToWorld * T);
        vBitangent = normalize(normalToWorld * B);

        vec3 pos = position;
        vec3 nrm = normal;

        if (uHasRelief == 1) {
          pos = normal * (1.0 + reliefAt(uv));

          // Central differences at the *tessellation's* spacing, not the map's,
          // so the normal describes the surface actually being drawn. Sampling
          // finer than the geometry reads as welcome extra detail right up until
          // relief is exaggerated, at which point texel-scale slopes far exceed
          // anything the triangles do and the surface shades as black speckle.
          // Taking both sides rather than one keeps the normal smooth instead of
          // snapping to each triangle's own face.
          vec2 du = vec2(uReliefStep.x, 0.0);
          vec2 dv = vec2(0.0, uReliefStep.y);
          // Meridians converge to nothing at the poles, so a v offset there stops
          // spanning any area and the cross product collapses. Keep the samples
          // one step inside the map; relief that close to a pole is a few pixels.
          vec2 uvN = vec2(uv.x, clamp(uv.y, uReliefStep.y, 1.0 - uReliefStep.y));
          vec3 e1 = sphereAt(uv + du) * (1.0 + reliefAt(uv + du))
                  - sphereAt(uv - du) * (1.0 + reliefAt(uv - du));
          vec3 e2 = sphereAt(uvN + dv) * (1.0 + reliefAt(uvN + dv))
                  - sphereAt(uvN - dv) * (1.0 + reliefAt(uvN - dv));

          vec3 n = cross(e1, e2);
          float len = length(n);
          if (len > 1e-12) {
            n /= len;
            // The cross product's sign depends on which way v runs and on the
            // frame's handedness; forcing it outward removes the need to reason
            // about either.
            nrm = dot(n, pos) < 0.0 ? -n : n;
          }
        }

        vNormal = normalize(normalToWorld * nrm);

        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
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
      uniform vec4 uOccluders[${MAX_OCCLUDERS}];
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
      ${GLSL_RING_SCALE_PARS}

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vTangent;
      varying vec3 vBitangent;

      ${GLSL_COLOR}
      ${GLSL_ECLIPSE}
      ${GLSL_RING_TO_KM}

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
    `,
  })
}

// ---------------------------------------------------------------------------
// Cloud shell (Earth, Venus)
// ---------------------------------------------------------------------------

/**
 * Latitude samples in the zonal wind profile — 19, one every 10 degrees, index
 * 0 at the south pole. See `BodySpec.cloudWindMs`.
 */
export const ZONAL_SAMPLES = 19

export function createCloudMaterial(map: Texture, opts: { opacity?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      // Angular form of the wind profile: degrees of longitude per day at each
      // sampled latitude. Filled in by the renderer, which is where the body's
      // radius lives. Zero everywhere means a deck that does not shear.
      uZonalDeg: { value: new Array<number>(ZONAL_SAMPLES).fill(0) },
      uHasFlow: { value: 0 },
      // Two ages, in days, and the weight of the second. See the fragment
      // shader for why there are two.
      uPhaseA: { value: 0 },
      uPhaseB: { value: 0 },
      uBlend: { value: 0 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uOpacity: { value: opts.opacity ?? 1 },
      uKmPerUnit: { value: 1 },
      uSunPosKm: { value: new Vector3(0, 0, 1.496e8) },
      uSunRadiusKm: { value: 695_700 },
      uBodyCentre: { value: new Vector3() },
      uOccluders: {
        value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4(0, 0, 0, 0)),
      },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uSunPos;
      uniform float uSunRadius;
      uniform float uOpacity;
      uniform float uKmPerUnit;
      uniform vec3 uSunPosKm;
      uniform float uSunRadiusKm;
      uniform vec3 uBodyCentre;
      uniform vec4 uOccluders[${MAX_OCCLUDERS}];
      uniform float uZonalDeg[${ZONAL_SAMPLES}];
      uniform float uHasFlow;
      uniform float uPhaseA;
      uniform float uPhaseB;
      uniform float uBlend;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${GLSL_COLOR}
      ${GLSL_ECLIPSE}

      #include <logdepthbuf_pars_fragment>

      /** Wind at this latitude, interpolated between the profile's samples. */
      float zonalRate(float v) {
        // v runs 0 at the north pole to 1 at the south — see createSphere() —
        // while the profile is indexed from the south, so latitude is the only
        // honest way to address it.
        float lat = 90.0 - v * 180.0;
        float t = (lat + 90.0) / 180.0 * float(${ZONAL_SAMPLES} - 1);
        float i = floor(t);
        int lo = int(clamp(i, 0.0, float(${ZONAL_SAMPLES} - 2)));
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
    `,
  })
}

// ---------------------------------------------------------------------------
// Atmosphere — single-scattering integration
// ---------------------------------------------------------------------------

export interface AtmosphereMaterialOptions {
  planetRadius: number
  atmosphereRadius: number
  rayleigh: [number, number, number]
  mie: number
  density: number
  /** View-ray march steps; 12 is plenty at these angular sizes. */
  steps?: number
}

/**
 * Single-scattering haze shell.
 *
 * Every length in this shader is measured in **scale heights**, which is the
 * one decision the whole thing rests on. The integral used to accumulate
 * optical depth in scene units, so `density` meant nothing on its own: the same
 * body was optically thicker at explore scale than at true scale (its radius
 * changes by 6x), and the number could not be compared against anything
 * published. Dividing every path length by the scale height makes the integral
 * dimensionless, and `density` becomes exactly the atmosphere's **vertical
 * optical depth** — a quantity that is in the literature for all nine bodies
 * that have one, and that is identical in both scale modes.
 *
 * `uPlanetRadius` and `uAtmoRadius` must arrive in the body's *rendered* scene
 * units, matching the mesh. Passing the ratio instead of the radius is what
 * kept this shader from drawing a single pixel for its first several months.
 */
export function createAtmosphereMaterial(opts: AtmosphereMaterialOptions): ShaderMaterial {
  const steps = opts.steps ?? 12
  const lightSteps = 4

  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Flipped per frame by updateVisual: front faces while the camera is
    // outside, so the haze is depth-tested against anything in front of it;
    // back faces with the depth test off once the camera is inside the shell,
    // where the front faces are behind the eye and the planet would otherwise
    // reject every fragment.
    side: FrontSide,
    blending: AdditiveBlending,
    uniforms: {
      uCentre: { value: new Vector3() },
      uPlanetRadius: { value: opts.planetRadius },
      uAtmoRadius: { value: opts.atmosphereRadius },
      uPole: { value: new Vector3(0, 0, 1) },
      uSquash: { value: 1 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uSunIntensity: { value: 1 },
      uRayleigh: { value: new Vector3(...opts.rayleigh) },
      uMie: { value: opts.mie },
      uDensity: { value: opts.density },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
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

      ${GLSL_RAY_SPHERE}

      #include <logdepthbuf_pars_fragment>

      const int STEPS = ${steps};
      const int LIGHT_STEPS = ${lightSteps};

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
    `,
  })
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

export interface RingMaterialOptions {
  texture: Texture
  /** Inner edge in true kilometres from the planet's centre. */
  innerKm: number
  /** Outer edge in true kilometres from the planet's centre. */
  outerKm: number
  opacity: number
  parentRadiusKm: number
}

export function createRingMaterial(opts: RingMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uTex: { value: prepare(opts.texture) },
      uInnerKm: { value: opts.innerKm },
      uOuterKm: { value: opts.outerKm },
      uOpacity: { value: opts.opacity },
      uExploreBoost: { value: 1 },
      uExploreBrightness: { value: 1 },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uPlanetCentre: { value: new Vector3() },
      uPlanetRadius: { value: 1 },
      uNormal: { value: new Vector3(0, 0, 1) },
      uParentRadiusKm: { value: opts.parentRadiusKm },
      uBodyScale: { value: 1 },
      uSatExponent: { value: 1 },
      uSatKnee: { value: 3 },
      uScaleBlend: { value: 0 },
      uSceneUnitKm: { value: 1000 },
    },
    vertexShader: /* glsl */ `
      // The annulus is built in true kilometres: position carries only the
      // unit direction in the ring plane and aRingKm the real radius, so the
      // one geometry serves both scale models and the profile stays registered
      // to kilometres however the radial remap stretches it.
      attribute float aRingKm;
      varying vec3 vWorldPos;
      varying float vRingKm;
      ${GLSL_RING_SCALE_PARS}
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_RING_TO_UNITS}
      void main() {
        vRingKm = aRingKm;
        vec3 local = vec3(position.xy * ringRadiusToUnits(aRingKm), position.z);
        vec4 world = modelMatrix * vec4(local, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
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

      ${GLSL_COLOR}
      ${GLSL_RAY_SPHERE}

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
    `,
  })
}

// ---------------------------------------------------------------------------
// Ring particles
// ---------------------------------------------------------------------------

/**
 * Individual ring particles, as instanced geometry placed by the vertex shader.
 *
 * A ring is 400,000 km across and its particles are metres wide, so there is no
 * question of drawing all of them. Instead a *patch* of a few thousand rocks
 * follows the camera through the ring, expressed in the ring's own cylindrical
 * frame (radius, arc, height) rather than in world space. Two things fall out
 * of that choice:
 *
 * **Keplerian shear comes for free, and it is the whole effect.** Each particle
 * orbits at its own radius's mean motion, and only the *difference* from the
 * camera's own rate is applied, so material inside you visibly overtakes and
 * material outside falls behind, at the real rate. Standing in the A ring you
 * are not parked in a static field of rocks — you are inside a shear flow. A
 * patch expressed in world space could not show this at all.
 *
 * **Wrapping is in arc, not in a box.** A particle that trails out the back
 * re-enters at the front, which is what a shear flow does anyway, so the
 * recycling is invisible rather than being a seam you can catch.
 *
 * Rocks shrink to nothing toward the patch boundary instead of fading, which
 * avoids needing transparency and therefore avoids sorting several thousand
 * instances every frame. And density is read from the ring's own profile
 * texture, so the gaps really are empty: fly along the A ring and the Encke gap
 * is a clear lane with Pan in it, because the same data drew both.
 */
export interface RingParticleMaterialOptions {
  profile: Texture
  innerKm: number
  outerKm: number
  parentRadiusKm: number
}

export function createRingParticleMaterial(opts: RingParticleMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uProfile: { value: prepare(opts.profile) },
      uInnerKm: { value: opts.innerKm },
      uOuterKm: { value: opts.outerKm },
      uCamRing: { value: new Vector3(0, 0, 0) },
      uPatchR: { value: 1 },
      uPatchS: { value: 1 },
      uPatchZ: { value: 1 },
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uGmKm: { value: 3.7931207e7 },
      uParticleKm: { value: 1 },
      uSunPos: { value: new Vector3() },
      uPlanetCentre: { value: new Vector3() },
      uPlanetRadius: { value: 1 },
      uParentRadiusKm: { value: opts.parentRadiusKm },
      uBodyScale: { value: 1 },
      uSatExponent: { value: 1 },
      uSatKnee: { value: 3 },
      uScaleBlend: { value: 0 },
      uSceneUnitKm: { value: 1000 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;   // radial, arc and vertical slot, each in [-1,1]
      attribute float aSeed;

      uniform sampler2D uProfile;
      uniform float uInnerKm;
      uniform float uOuterKm;
      uniform vec3 uCamRing;    // camera in ring coords: radius km, angle rad, height km
      uniform float uPatchR;
      uniform float uPatchS;
      uniform float uPatchZ;
      uniform float uTime;
      uniform float uSpin;
      uniform float uGmKm;
      uniform float uParticleKm;
      ${GLSL_RING_SCALE_PARS}

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec3 vTint;

      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_RING_TO_UNITS}

      // Smallest and largest drawn rock, as multiples of the characteristic
      // size. The mean lands near 0.8 of it, so the field keeps roughly the
      // density a single fixed size gave while gaining a tail of boulders.
      const float SIZE_MIN = 0.45;
      const float SIZE_MAX = 4.0;

      float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

      // Cheap value noise on the unit sphere, to make each rock its own shape.
      float lumpiness(vec3 dir, float seed) {
        float a = sin(dir.x * 4.1 + seed * 6.3) * sin(dir.y * 3.7 - seed * 2.1);
        float b = sin(dir.z * 5.3 - seed * 4.7) * sin(dir.x * 2.9 + seed * 8.9);
        return 0.72 + 0.28 * (a * 0.6 + b * 0.4);
      }

      // Spin axes cluster around the orbit normal rather than pointing
      // anywhere. A particle in a shear flow is spun up by collisions, and the
      // shear picks a sense, so the population ends up mostly prograde about
      // the ring's own axis with collisions tilting it and flipping a minority
      // retrograde. Uniformly random axes read as chaotic debris; this reads as
      // a disc. (Physical spin rates are of order the orbital frequency — one
      // turn in ~14 h at Saturn — far too slow to see, so the *rate* below is
      // frankly a visual choice, while the axis distribution is not.)
      mat3 tumble(float seed, float t) {
        float sense = hash11(seed + 3.3) < 0.15 ? -1.0 : 1.0;
        vec3 axis = normalize(vec3(
          (hash11(seed) - 0.5) * 1.1,
          (hash11(seed + 1.7) - 0.5) * 1.1,
          sense * 1.6
        ));
        float ang = t * (0.05 + hash11(seed + 5.1) * 0.25) + seed * 6.2831;
        float c = cos(ang), s = sin(ang), ic = 1.0 - c;
        return mat3(
          c + axis.x * axis.x * ic,          axis.x * axis.y * ic - axis.z * s, axis.x * axis.z * ic + axis.y * s,
          axis.y * axis.x * ic + axis.z * s, c + axis.y * axis.y * ic,          axis.y * axis.z * ic - axis.x * s,
          axis.z * axis.x * ic - axis.y * s, axis.z * axis.y * ic + axis.x * s, c + axis.z * axis.z * ic
        );
      }

      void main() {
        // Each rock has a fixed home in the ring, and the field repeats around
        // the camera on a lattice. Snapping to the nearest whole period means a
        // rock's position is *absolute* between jumps: fly at it and it comes
        // to meet you, fly past and it falls behind. Anchoring positions to the
        // camera instead — camRadius + offset — welds the whole field to your
        // eye, so nothing can ever be approached and the ring reads as static
        // no matter how much shear is applied on top.
        float period = 2.0 * uPatchR;
        float rBase = aOffset.x * uPatchR;
        float r = rBase + floor((uCamRing.x - rBase) / period + 0.5) * period;
        if (r < uInnerKm || r > uOuterKm) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

        // Density from the ring's own profile: a gap has no particles in it
        // because the same table that drew the gap is what is sampled here.
        float u = (r - uInnerKm) / (uOuterKm - uInnerKm);
        float dens = texture2D(uProfile, vec2(u, 0.5)).a;

        // Only the difference from the camera's own orbital rate is applied, so
        // the camera behaves as a spacecraft in a circular orbit at its own
        // radius: material beside you keeps station and can be flown to, while
        // material inside overtakes and material outside falls behind, at the
        // true rate. Applying the full rate instead sweeps everything past at
        // 16 km/s, which is honest and completely unusable.
        float rc = max(uCamRing.x, 1.0);
        float n = sqrt(uGmKm / (r * r * r));
        float nc = sqrt(uGmKm / (rc * rc * rc));

        // Same lattice trick azimuthally. The angle is formed *then* differenced
        // against the camera, so flying along the ring carries you past rocks
        // rather than dragging them with you.
        float dPeriod = period / max(r, 1.0);
        float dTheta = aOffset.y * 3.14159265 + (n - nc) * uTime - uCamRing.y;
        dTheta -= floor(dTheta / dPeriod + 0.5) * dPeriod;
        float theta = uCamRing.y + dTheta;
        float zKm = aOffset.z * uPatchZ;

        // Into scene units, through the same radial remap the sheet uses.
        float ru = ringRadiusToUnits(r);
        float kmToUnits = ru / max(r, 1.0);
        vec3 centre = vec3(ru * cos(theta), ru * sin(theta), zKm * kmToUnits);

        // Shrink to nothing at the field edge rather than fading, which keeps
        // the material opaque and spares sorting several thousand instances.
        // Measured from the wrapped offsets, not the raw slots, so the taper
        // stays put in space while rocks move through it.
        float edge = max(abs(r - uCamRing.x) / uPatchR, abs(dTheta) / (dPeriod * 0.5));
        // Sizes follow a power law rather than being uniformly jittered, which
        // is what a collisional population actually looks like: mostly gravel,
        // with occasional boulders standing well above it. Occultations put the
        // differential index near 3 across Saturn's rings, so that is the index
        // used, sampled by inverting its cumulative distribution.
        //
        //   n(a) da ~ a^-3 da  =>  a(u) = [ a0^-2 + u (a1^-2 - a0^-2) ]^(-1/2)
        //
        // which is one inversesqrt of a mix. The absolute *range* is exaggerated
        // like everything else here — real particles run centimetres to about
        // ten metres, a spread far too fine to draw — but the shape of the
        // distribution is the real one, and it is what gives the field depth
        // instead of a single repeated pebble size.
        float u01 = hash11(aSeed + 9.1);
        float sizeMul = inversesqrt(
          mix(1.0 / (SIZE_MIN * SIZE_MIN), 1.0 / (SIZE_MAX * SIZE_MAX), u01)
        );
        // Size is an absolute number of kilometres, not a fraction of the
        // patch. That is what lets a rock grow as you close on it; scaling it
        // with the patch held its angular size fixed however near you got.
        float size = uParticleKm * kmToUnits
          * sizeMul
          * (1.0 - smoothstep(0.75, 1.0, edge))
          * smoothstep(0.015, 0.12, dens);

        mat3 spin = tumble(aSeed, uSpin);
        vec3 dir = normalize(position);
        vec3 local = spin * (dir * lumpiness(dir, aSeed) * size);

        vec4 world = modelMatrix * vec4(centre + local, 1.0);
        vWorldPos = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * (spin * dir));
        // Carry the local ring colour so a rock matches the band it sits in.
        vTint = texture2D(uProfile, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb;

        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunPos;
      uniform vec3 uPlanetCentre;
      uniform float uPlanetRadius;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec3 vTint;

      ${GLSL_COLOR}
      ${GLSL_RAY_SPHERE}
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
    `,
  })
}

// ---------------------------------------------------------------------------
// The Sun
// ---------------------------------------------------------------------------

export function createSunMaterial(map: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map ? prepare(map) : null },
      uHasMap: { value: map ? 1 : 0 },
      uTime: { value: 0 },
      uIntensity: { value: 6.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      uniform int uHasMap;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${GLSL_COLOR}

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
    `,
  })
}

/** Soft corona shell that fades outward; additive, drawn after the photosphere. */
export function createCoronaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Vector3(1.0, 0.72, 0.42) },
      uIntensity: { value: 1.0 },
      uCentre: { value: new Vector3() },
      uInner: { value: 1 },
      uOuter: { value: 2 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform vec3 uCentre;
      uniform float uInner;
      uniform float uOuter;
      varying vec3 vWorldPos;

      ${GLSL_RAY_SPHERE}

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
    `,
  })
}

// ---------------------------------------------------------------------------
// The sky
//
// Two layers on one camera-following sphere: the deep sky as a texture, and the
// Hipparcos stars as point sources on top. Both are pinned to the far plane by
// the same one-line trick, described on GLSL_SKY_DEPTH.
// ---------------------------------------------------------------------------

/**
 * Put a vertex on the far plane, whatever its actual distance.
 *
 * Setting clip-space z equal to w lands the vertex exactly on the far plane, so
 * the depth test resolves the sky behind literally everything without the
 * radius of the sky sphere having to mean anything. That matters here more than
 * in an ordinary scene: Aphelion recomputes its near and far planes every frame
 * from how much space is in front of the camera, and they range over eleven
 * orders of magnitude. Any fixed radius is inside the near plane at one focus
 * and beyond the far plane at another — the previous backdrop sat at 1e8 units,
 * which is outside the far plane for most views.
 *
 * It also removes the near plane from the argument: clipping tests -w <= z <= w,
 * and z = w satisfies both, so the only vertices that go are the ones genuinely
 * behind the eye. Depth *writing* stays off, so the sky never occludes anything
 * that is drawn afterwards.
 *
 * The 1e-6 backs off the exact boundary, where some drivers round the wrong way
 * and drop the fragment.
 */
const GLSL_SKY_DEPTH = /* glsl */ `
vec4 pinToFarPlane(vec4 clip) {
  return vec4(clip.xy, clip.w * (1.0 - 1e-6), clip.w);
}
`

/**
 * The deep sky, as an equirectangular texture on the inside of a sphere.
 *
 * The sphere's own frame is ICRF/J2000 equatorial — the caller rotates it into
 * the ecliptic — so u = 0.5 is right ascension zero and v = 0 is the north
 * celestial pole.
 */
export function createSkyMaterial(map: Texture, opts: { brightness?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      uBrightness: { value: opts.brightness ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      ${GLSL_SKY_DEPTH}
      void main() {
        vUv = uv;
        gl_Position = pinToFarPlane(projectionMatrix * modelViewMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uBrightness;
      varying vec2 vUv;
      ${GLSL_COLOR}
      void main() {
        vec3 c = srgbToLinear(texture2D(uMap, vUv).rgb);
        gl_FragColor = vec4(c * uBrightness, 1.0);
      }
    `,
  })
}

/**
 * Real stars, drawn as point sources.
 *
 * Every star is the same optical system's response to a point of light, so the
 * only thing that differs between them is how much light arrives. That single
 * assumption fixes both the size and the brightness law:
 *
 *   - **Brightness follows Pogson**: flux is 10^(-0.4 m), which is the
 *     amplitude at the centre of the sprite, times an exposure.
 *   - **Size is wherever that profile crosses the visibility threshold.** Sirius
 *     is a disc and an eighth-magnitude star is a dot not because the instrument
 *     changed but because the same profile, scaled up 1600-fold, stays above the
 *     threshold much further out.
 *
 * The profile is a **Moffat** function, `1 / (1 + (r/a)^2)^beta`, not a
 * Gaussian. That is the standard empirical model for a stellar image precisely
 * because a Gaussian understates the wings, and the difference is the whole
 * visual hierarchy of the sky: a Gaussian spans only sqrt(m) in radius, giving
 * Sirius barely three times the disc of a naked-eye star, where the Moffat wings
 * put it at ten and the field stops looking like uniform beads. Eight magnitudes
 * is a range of 1600:1 that no display can show as brightness alone, so size has
 * to carry it — which is exactly what it does in a real photograph.
 *
 * Writing the profile in units of the sprite's own radius makes it
 * self-consistent: every star reaches the same brightness at its rim, so `uGain`
 * is not an arbitrary scale but the display's own visibility threshold, and
 * `uMagLimit` is the magnitude at which a star reaches it. The only genuinely
 * chosen number is `uSizeScale`, the width of the point spread function in
 * pixels, and one pixel is the right answer for any sampled optical system.
 *
 * Stars do not twinkle. Scintillation is atmospheric, and there is no
 * atmosphere between this camera and them.
 */
export function createStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      /** Julian years since J2000, for proper motion. */
      uYears: { value: 0 },
      uPixelRatio: { value: 1 },
      /**
       * Magnitude at which a star's disc shrinks to nothing — the limiting
       * magnitude of the render. Set a little fainter than the catalogue's own
       * limit so its faintest stars are still drawn rather than vanishing
       * exactly at the cutoff.
       */
      uMagLimit: { value: 9 },
      /** Width of the point spread function, in pixels. */
      uSizeScale: { value: 1.5 },
      /** The display's visibility threshold, in linear light. */
      uGain: { value: 0.006 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      // The position attribute is the unit vector toward the star at J2000, in
      // ICRF equatorial coordinates; the object's own matrix rotates that frame
      // into the ecliptic.
      attribute vec3 aProperMotion;   // radians per Julian year, tangential
      attribute float aMagnitude;     // Johnson V
      attribute vec3 aColor;          // sRGB chromaticity, strongest channel full

      uniform float uYears;
      uniform float uPixelRatio;
      uniform float uMagLimit;
      uniform float uSizeScale;
      uniform float uGain;

      varying vec3 vColor;
      varying float vSharpness;

      ${GLSL_COLOR}
      ${GLSL_SKY_DEPTH}

      const float BETA = 2.5;

      void main() {
        // Proper motion, on the tangent plane at the star. Over the 900 years
        // the clock covers this is tens of arcminutes for the fastest movers,
        // and renormalising is all the curvature correction that needs.
        vec3 dir = normalize(position + aProperMotion * uYears);

        gl_Position = pinToFarPlane(projectionMatrix * modelViewMatrix * vec4(dir, 1.0));

        // Magnitudes of headroom above the limit, and the flux that implies.
        float headroom = max(uMagLimit - aMagnitude, 0.0);
        float amplitude = uGain * pow(10.0, 0.4 * headroom);

        // Radius, in units of the profile's core width, at which this star
        // fades to the threshold. Solving the Moffat profile for that radius is
        // what ties size to brightness with nothing left to choose.
        float spread = sqrt(max(pow(10.0, 0.4 * headroom / BETA) - 1.0, 0.0));
        float radius = uSizeScale * spread * uPixelRatio;
        float size = clamp(2.0 * radius, uPixelRatio, 64.0 * uPixelRatio);
        gl_PointSize = size;
        vSharpness = spread * spread;

        // A sprite floored to a visible size spreads its light over more pixels
        // than it should; scale the amplitude back so the star still delivers
        // what its magnitude says.
        float floored = 2.0 * radius / size;
        amplitude *= floored * floored;

        // Divide out the stored colour's luminance so hue and brightness stay
        // independent: a red and a blue star of the same V magnitude must put
        // the same amount of light on the screen.
        vec3 chroma = srgbToLinear(aColor);
        float luma = max(dot(chroma, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
        vColor = chroma / luma * amplitude;
      }
    `,
    fragmentShader: /* glsl */ `
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
    `,
  })
}

// ---------------------------------------------------------------------------
// Belt swarms — orbits solved on the GPU
// ---------------------------------------------------------------------------

/**
 * Points material that propagates each particle's own Keplerian orbit in the
 * vertex shader. Uploading ~70,000 sets of elements once and advancing them on
 * the GPU is what makes a live, correctly-structured belt affordable.
 *
 * The scale remapping is duplicated here in GLSL to match ScaleModel exactly.
 */
export function createSwarmMaterial(sprite: Texture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uSprite: { value: prepare(sprite) },
      uDays: { value: 0 },
      uAuKm: { value: 149597870.7 },
      uSceneUnitKm: { value: 1000 },
      uBlend: { value: 1 },
      uHelioExp: { value: 0.6 },
      uPointScale: { value: 1 },
      uOpacity: { value: 1 },
      uSunPos: { value: new Vector3() },
      uPixelRatio: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute float aA;        // semi-major axis, AU
      attribute float aE;
      attribute float aInc;      // radians
      attribute float aNode;
      attribute float aPeri;
      attribute float aM0;
      attribute float aN;        // radians/day
      attribute float aSize;
      attribute vec3 aColor;

      uniform float uDays;
      uniform float uAuKm;
      uniform float uSceneUnitKm;
      uniform float uBlend;
      uniform float uHelioExp;
      uniform float uPointScale;
      uniform float uPixelRatio;

      varying vec3 vColor;
      varying float vFade;

      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vColor = aColor;

        // Advance the mean anomaly and solve Kepler's equation. Three Newton
        // steps is ample for the eccentricities in these populations.
        float M = aM0 + aN * uDays;
        M = mod(M + 3.14159265, 6.28318531) - 3.14159265;
        float E = M + aE * sin(M) * (1.0 + aE * cos(M));
        for (int i = 0; i < 3; i++) {
          float f = E - aE * sin(E) - M;
          E -= f / max(1.0 - aE * cos(E), 1e-4);
        }

        float aKm = aA * uAuKm;
        float xp = aKm * (cos(E) - aE);
        float yp = aKm * sqrt(max(0.0, 1.0 - aE * aE)) * sin(E);

        float cw = cos(aPeri), sw = sin(aPeri);
        float co = cos(aNode), so = sin(aNode);
        float ci = cos(aInc), si = sin(aInc);

        vec3 posKm = vec3(
          (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
          (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
          sw * si * xp + cw * si * yp
        );

        // Mirror ScaleModel.heliocentricDistance().
        float r = max(length(posKm), 1.0);
        float compressed = uAuKm * pow(r / uAuKm, uHelioExp);
        float remapped = mix(r, compressed, uBlend);
        vec3 scenePos = posKm * (remapped / r) / uSceneUnitKm;

        // modelViewMatrix, NOT viewMatrix: the swarm hangs off the world group,
        // whose position carries the floating origin. Skipping the model matrix
        // left every particle at its absolute heliocentric coordinate while the
        // rest of the scene had been shifted, so the belts appeared centred on
        // whatever body was focused instead of on the Sun — invisible only when
        // the Sun itself was focused and the shift happened to be zero.
        //
        // Three composes modelViewMatrix on the CPU in double precision, so this
        // is also the more accurate way to reach view space.
        vec4 mv = modelViewMatrix * vec4(scenePos, 1.0);
        gl_Position = projectionMatrix * mv;

        float dist = max(-mv.z, 1e-4);
        gl_PointSize = clamp(aSize * uPointScale * uPixelRatio * 260.0 / dist, 0.9, 5.0);
        // Fade the smallest points instead of letting them alias.
        vFade = clamp(gl_PointSize / 1.4, 0.26, 1.0);

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSprite;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vFade;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float a = texture2D(uSprite, gl_PointCoord).a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a * vFade * uOpacity);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// Orbit lines
// ---------------------------------------------------------------------------

/**
 * Travel dust — short streaks that only exist while the camera is moving fast.
 *
 * The particles are a fixed cloud in a cube of one cell, wrapped modulo that
 * cube around the camera in the vertex shader. That makes the field effectively
 * infinite with no recycling pass on the CPU, and lets the cell resize with the
 * camera's speed so the same few hundred particles read correctly whether the
 * motion is kilometres or astronomical units per second.
 *
 * Each particle is a two-vertex segment whose tail is dragged *back along the
 * way it came*, which is +velocity in world terms: over the last frame the
 * camera advanced by `uStreak`, so where the particle appeared to be then is
 * where it is now plus that step. Dragging it the other way — the intuitive
 * reading, and what this did — points every streak at the destination and makes
 * the field read as flying the wrong way.
 *
 * **The cell must not be a smooth function of speed.** Particle positions are
 * `position * cell`, so resizing the cell drags the whole lattice through the
 * world: on the approach, where the flight decelerates and the cell shrinks
 * frame by frame, the drift measured 1.3-6.8x the camera's own motion and
 * pointed at the body being approached — the dust converged on the destination
 * instead of streaming past. So the lattice is quantised to powers of two,
 * which holds it perfectly still between steps, and two of them are kept a
 * factor of two apart and cross-faded: the one that has to jump when the step
 * comes is at zero weight exactly then, so the change is invisible.
 */
export function createDustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      // The camera position reduced modulo each cell, in double precision on the
      // CPU — the only form of it the shader ever sees. Passing it whole would
      // lose the wrap wherever the camera is many cells from the render origin,
      // a float32 coordinate there being coarser than a cell.
      uCamA: { value: new Vector3() },
      uCamB: { value: new Vector3() },
      uStreak: { value: new Vector3() },
      // One cell per cloud, an octave apart — which of the two is the coarser
      // alternates, so the caller owns the pairing. uBlend is cloud B's share.
      uCellA: { value: 1 },
      uCellB: { value: 2 },
      uBlend: { value: 0 },
      uIntensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      attribute float aLattice;
      varying float vFade;

      uniform vec3 uCamA;
      uniform vec3 uCamB;
      uniform vec3 uStreak;
      uniform float uCellA;
      uniform float uCellB;
      uniform float uBlend;
      uniform float uIntensity;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        float cell = mix(uCellA, uCellB, aLattice);
        vec3 camMod = mix(uCamA, uCamB, aLattice);
        float weight = mix(1.0 - uBlend, uBlend, aLattice);

        // Wrap the particle into the cell centred on the camera. Without the
        // half-cell shift the modulo folds at the camera itself, and the dust
        // visibly pops as it crosses the eye.
        vec3 rel = mod(position * cell - camMod + 0.5 * cell, cell) - 0.5 * cell;

        // Fade with distance from the camera, so particles arrive and leave
        // rather than blinking into existence at the cell boundary.
        float d = length(rel) / (0.5 * cell);
        vFade = uIntensity * weight * smoothstep(1.0, 0.55, d) * (1.0 - aEnd * 0.75);

        // Placed as an offset from the eye, never as an absolute position. The
        // camera sits at the origin of view space, so rotating the offset is the
        // whole transform — and the field is still anchored in the world, since
        // the wrap above pins it to the lattice. Building a world position first
        // would mean adding a number the size of the solar system to one the size
        // of a cell, in float32, at the far end of a flight: the field would land
        // on a grid coarser than a frame's travel and jitter as the eye moved.
        gl_Position = projectionMatrix
          * vec4(mat3(viewMatrix) * (rel + uStreak * aEnd), 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vFade;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>
        if (vFade <= 0.001) discard;
        gl_FragColor = vec4(vec3(0.62, 0.72, 0.9), vFade * 0.5);
      }
    `,
  })
}

export function createOrbitMaterial(color: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      // Fades the trailing half of the orbit so the direction of travel reads.
      uHeadIndex: { value: 0 },
      uCount: { value: 1 },
      uTaper: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aIndex;
      varying float vT;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vT = aIndex;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
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
    `,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark a texture as already-linear so Three.js leaves it alone; every custom
 * shader above decodes sRGB itself. Keeps the colour pipeline in one place.
 */
function prepare(tex: Texture): Texture {
  tex.colorSpace = LinearSRGBColorSpace
  return tex
}

/** Push occluder data into a material's uniform array. */
export function setOccluders(
  material: ShaderMaterial,
  occluders: { x: number; y: number; z: number; radius: number }[],
): void {
  const slot = material.uniforms.uOccluders?.value as Vector4[] | undefined
  if (!slot) return
  for (let i = 0; i < MAX_OCCLUDERS; i++) {
    const src = occluders[i]
    const dst = slot[i]!
    if (src) dst.set(src.x, src.y, src.z, src.radius)
    else dst.set(0, 0, 0, 0)
  }
}
