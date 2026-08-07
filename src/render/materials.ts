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
    // Ring shadow cast onto the planet.
    uRingEnabled: { value: 0 },
    uRingTex: { value: null as Texture | null },
    uRingInner: { value: 0 },
    uRingOuter: { value: 1 },
    uRingNormal: { value: new Vector3(0, 0, 1) },
    uBodyCentre: { value: new Vector3() },
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
      uniform float uRingInner;
      uniform float uRingOuter;
      uniform vec3 uRingNormal;
      uniform vec3 uBodyCentre;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vTangent;
      varying vec3 vBitangent;

      ${GLSL_COLOR}
      ${GLSL_ECLIPSE}

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
        // crosses the ring plane inside the annulus.
        float ringShadow = 1.0;
        if (uRingEnabled == 1) {
          float denom = dot(L, uRingNormal);
          if (abs(denom) > 1e-6) {
            float t = dot(uBodyCentre - vWorldPos, uRingNormal) / denom;
            if (t > 0.0) {
              vec3 hit = vWorldPos + L * t;
              float r = length(hit - uBodyCentre);
              if (r > uRingInner && r < uRingOuter) {
                float u = (r - uRingInner) / (uRingOuter - uRingInner);
                float opacity = texture2D(uRingTex, vec2(u, 0.5)).a;
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

export function createCloudMaterial(map: Texture, opts: { opacity?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
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
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${GLSL_COLOR}
      ${GLSL_ECLIPSE}

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>
        vec4 tex = texture2D(uMap, vUv);
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

export function createAtmosphereMaterial(opts: AtmosphereMaterialOptions): ShaderMaterial {
  const steps = opts.steps ?? 12
  const lightSteps = 4

  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Render the inside of the shell so there is always a fragment, whether the
    // camera is outside the atmosphere or flying through it.
    side: BackSide,
    blending: AdditiveBlending,
    uniforms: {
      uCentre: { value: new Vector3() },
      uPlanetRadius: { value: opts.planetRadius },
      uAtmoRadius: { value: opts.atmosphereRadius },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uRayleigh: { value: new Vector3(...opts.rayleigh) },
      uMie: { value: opts.mie },
      uDensity: { value: opts.density },
      uExposure: { value: 1 },
      uOccluders: {
        value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4(0, 0, 0, 0)),
      },
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
      uniform vec3 uSunPos;
      uniform float uSunRadius;
      uniform vec3 uRayleigh;
      uniform float uMie;
      uniform float uDensity;
      uniform float uExposure;
      uniform vec4 uOccluders[${MAX_OCCLUDERS}];

      varying vec3 vWorldPos;

      ${GLSL_RAY_SPHERE}
      ${GLSL_ECLIPSE}

      #include <logdepthbuf_pars_fragment>

      const int STEPS = ${steps};
      const int LIGHT_STEPS = ${lightSteps};

      // Exponential atmosphere: the shell thickness is ~5 scale heights.
      float densityAt(vec3 p) {
        float h = length(p - uCentre) - uPlanetRadius;
        float H = (uAtmoRadius - uPlanetRadius) / 5.0;
        return exp(-max(h, 0.0) / max(H, 1e-6));
      }

      // Optical depth from a point toward the Sun.
      float lightOpticalDepth(vec3 p, vec3 L) {
        vec2 hit = raySphere(p, L, uCentre, uAtmoRadius);
        if (hit.y < hit.x) return 0.0;
        float len = max(hit.y, 0.0);
        float stepLen = len / float(LIGHT_STEPS);
        float total = 0.0;
        vec3 pos = p + L * stepLen * 0.5;
        for (int i = 0; i < LIGHT_STEPS; i++) {
          total += densityAt(pos) * stepLen;
          pos += L * stepLen;
        }
        return total;
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorldPos - cameraPosition);

        vec2 atmo = raySphere(ro, rd, uCentre, uAtmoRadius);
        if (atmo.y < atmo.x) discard;

        float tNear = max(atmo.x, 0.0);
        float tFar = atmo.y;

        // Stop at the planet's surface if the ray hits it.
        vec2 solid = raySphere(ro, rd, uCentre, uPlanetRadius);
        bool hitsSurface = solid.y >= solid.x && solid.y > 0.0;
        if (hitsSurface) tFar = min(tFar, max(solid.x, 0.0));
        if (tFar <= tNear) discard;

        float segment = tFar - tNear;
        float stepLen = segment / float(STEPS);

        vec3 rayleighTotal = vec3(0.0);
        float mieTotal = 0.0;
        float viewOpticalDepth = 0.0;

        vec3 pos = ro + rd * (tNear + stepLen * 0.5);
        vec3 sunDir = normalize(uSunPos - uCentre);

        for (int i = 0; i < STEPS; i++) {
          float d = densityAt(pos);
          float dOpt = d * stepLen;
          viewOpticalDepth += dOpt;

          // Is this sample in the planet's own shadow?
          vec3 L = normalize(uSunPos - pos);
          vec2 shadowHit = raySphere(pos, L, uCentre, uPlanetRadius);
          bool inShadow = shadowHit.y >= shadowHit.x && shadowHit.x > 0.0;

          if (!inShadow) {
            float lOpt = lightOpticalDepth(pos, L);
            // Transmittance along light path then view path.
            vec3 tau = uRayleigh * (lOpt + viewOpticalDepth) * uDensity
                     + vec3(uMie) * (lOpt + viewOpticalDepth) * uDensity * 0.15;
            vec3 transmittance = exp(-tau);
            // The shell scales uniformly with the planet, so the self-shadow
            // test above is exact in either scale mode; third-body eclipse
            // shadowing of the haze is left to the surface shader.
            rayleighTotal += d * transmittance;
            mieTotal += d * transmittance.r;
          }
          pos += rd * stepLen;
        }

        rayleighTotal *= stepLen * uDensity;
        mieTotal *= stepLen * uDensity;

        float mu = dot(rd, normalize(uSunPos - ro));
        // Rayleigh phase.
        float phaseR = 0.0596831 * (1.0 + mu * mu);
        // Cornette-Shanks Mie phase, g = 0.76: strong forward scattering.
        float g = 0.76;
        float g2 = g * g;
        float phaseM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu))
                     / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

        vec3 colour = rayleighTotal * uRayleigh * phaseR * 22.0
                    + mieTotal * uMie * phaseM * 14.0;

        colour *= uExposure;

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
  innerRadius: number
  outerRadius: number
  opacity: number
}

export function createRingMaterial(opts: RingMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uTex: { value: prepare(opts.texture) },
      uInner: { value: opts.innerRadius },
      uOuter: { value: opts.outerRadius },
      uOpacity: { value: opts.opacity },
      uSunPos: { value: new Vector3() },
      uSunRadius: { value: 1 },
      uPlanetCentre: { value: new Vector3() },
      uPlanetRadius: { value: 1 },
      uNormal: { value: new Vector3(0, 0, 1) },
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
      uniform sampler2D uTex;
      uniform float uInner;
      uniform float uOuter;
      uniform float uOpacity;
      uniform vec3 uSunPos;
      uniform float uSunRadius;
      uniform vec3 uPlanetCentre;
      uniform float uPlanetRadius;
      uniform vec3 uNormal;
      varying vec3 vWorldPos;

      ${GLSL_COLOR}
      ${GLSL_RAY_SPHERE}

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        // Radial coordinate across the annulus.
        float r = length(vWorldPos - uPlanetCentre);
        float u = (r - uInner) / (uOuter - uInner);
        if (u < 0.0 || u > 1.0) discard;

        vec4 tex = texture2D(uTex, vec2(u, 0.5));
        float alpha = tex.a * uOpacity;
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

        vec3 colour = albedo * brightness * shadow;
        gl_FragColor = vec4(colour, alpha);
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
// Star field / Milky Way backdrop
// ---------------------------------------------------------------------------

export function createSkyMaterial(map: Texture, opts: { brightness?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uMap: { value: prepare(map) },
      uBrightness: { value: opts.brightness ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
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
 * The particles are a fixed cloud in a cube of side `uCell`, wrapped modulo that
 * cube around the camera in the vertex shader. That makes the field effectively
 * infinite with no recycling pass on the CPU, and lets the cell resize with the
 * camera's speed so the same few hundred particles read correctly whether the
 * motion is kilometres or astronomical units per second.
 *
 * Each particle is a two-vertex segment whose tail is dragged back along the
 * velocity, so the streak length is the distance actually covered in a frame
 * rather than an arbitrary constant.
 */
export function createDustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uCamPos: { value: new Vector3() },
      uStreak: { value: new Vector3() },
      uCell: { value: 1 },
      uIntensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      varying float vFade;

      uniform vec3 uCamPos;
      uniform vec3 uStreak;
      uniform float uCell;
      uniform float uIntensity;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        // Wrap the particle into the cell centred on the camera. Without the
        // half-cell shift the modulo folds at the camera itself, and the dust
        // visibly pops as it crosses the eye.
        vec3 rel = mod(position * uCell - uCamPos + 0.5 * uCell, uCell) - 0.5 * uCell;
        vec3 world = uCamPos + rel - uStreak * aEnd;

        // Fade with distance from the camera, so particles arrive and leave
        // rather than blinking into existence at the cell boundary.
        float d = length(rel) / (0.5 * uCell);
        vFade = uIntensity * smoothstep(1.0, 0.55, d) * (1.0 - aEnd * 0.75);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
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
