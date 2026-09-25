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
  ShaderChunk,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import atmosphereFragmentShader from './shaders/atmosphere.frag.glsl?raw';
import atmosphereVertexShader from './shaders/atmosphere.vert.glsl?raw';
import bodyFragmentShader from './shaders/body.frag.glsl?raw';
import bodyVertexShader from './shaders/body.vert.glsl?raw';
import colorChunk from './shaders/chunks/color.glsl?raw';
import eclipseChunk from './shaders/chunks/eclipse.glsl?raw';
import raySphereChunk from './shaders/chunks/ray_sphere.glsl?raw';
import ringScaleParsChunk from './shaders/chunks/ring_scale_pars.glsl?raw';
import ringToKmChunk from './shaders/chunks/ring_to_km.glsl?raw';
import ringToUnitsChunk from './shaders/chunks/ring_to_units.glsl?raw';
import skyDepthChunk from './shaders/chunks/sky_depth.glsl?raw';
import cloudFragmentShader from './shaders/cloud.frag.glsl?raw';
import cloudVertexShader from './shaders/cloud.vert.glsl?raw';
import coronaFragmentShader from './shaders/corona.frag.glsl?raw';
import coronaVertexShader from './shaders/corona.vert.glsl?raw';
import dustFragmentShader from './shaders/dust.frag.glsl?raw';
import dustVertexShader from './shaders/dust.vert.glsl?raw';
import orbitFragmentShader from './shaders/orbit.frag.glsl?raw';
import orbitVertexShader from './shaders/orbit.vert.glsl?raw';
import ringParticleFragmentShader from './shaders/ring-particle.frag.glsl?raw';
import ringParticleVertexShader from './shaders/ring-particle.vert.glsl?raw';
import ringFragmentShader from './shaders/ring.frag.glsl?raw';
import ringVertexShader from './shaders/ring.vert.glsl?raw';
import skyFragmentShader from './shaders/sky.frag.glsl?raw';
import skyVertexShader from './shaders/sky.vert.glsl?raw';
import starFragmentShader from './shaders/star.frag.glsl?raw';
import starVertexShader from './shaders/star.vert.glsl?raw';
import sunFragmentShader from './shaders/sun.frag.glsl?raw';
import sunVertexShader from './shaders/sun.vert.glsl?raw';
import swarmFragmentShader from './shaders/swarm.frag.glsl?raw';
import swarmVertexShader from './shaders/swarm.vert.glsl?raw';

/** Maximum simultaneous eclipse occluders per body. */
export const MAX_OCCLUDERS = 4;

// ---------------------------------------------------------------------------
// Typed uniform access
//
// Three types every uniform value as `any`, so a misspelt name or a value of
// the wrong kind would otherwise surface as an unexplained error somewhere deep
// inside a frame. Each accessor checks the value it hands back with a single
// `instanceof` — no allocation, so they are safe in the per-frame paths — and
// fails naming the uniform instead.

type Uniforms = ShaderMaterial['uniforms'];

function uniformOf<T>(
  uniforms: Uniforms,
  name: string,
  kind: abstract new (...args: never[]) => T,
): T {
  const value: unknown = uniforms[name]?.value;
  if (value instanceof kind) {
    return value;
  }
  throw new TypeError(`[aphelion] uniform ${name} does not hold a ${kind.name}`);
}

/** The Vector2 a uniform holds, to be updated in place. */
export function vec2Uniform(uniforms: Uniforms, name: string): Vector2 {
  return uniformOf(uniforms, name, Vector2);
}

/** The Vector3 a uniform holds, to be updated in place. */
export function vec3Uniform(uniforms: Uniforms, name: string): Vector3 {
  return uniformOf(uniforms, name, Vector3);
}

/** The texture a sampler uniform currently points at. */
export function textureUniform(uniforms: Uniforms, name: string): Texture {
  return uniformOf(uniforms, name, Texture);
}

function isVector4Array(value: unknown): value is Vector4[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const items: ReadonlyArray<unknown> = value;
  for (const item of items) {
    if (!(item instanceof Vector4)) {
      return false;
    }
  }
  return true;
}

/** The fixed-length occluder slots of an eclipse-aware material, if it has them. */
export function occluderSlots(material: ShaderMaterial): Vector4[] | undefined {
  const value: unknown = material.uniforms.uOccluders?.value;
  return isVector4Array(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

// Registered as Three.js shader chunks so every stage file can pull them in
// with `#include <aphelion_*>`, the same way it pulls in Three's own
// `<logdepthbuf_*>` chunks. Three resolves includes when it compiles a program,
// and every material here is created after this module has loaded.
//
// Compile-time sizes (MAX_OCCLUDERS, ZONAL_SAMPLES, the atmosphere's march
// steps) are passed as `defines` on each material instead, so the GLSL and the
// uniform arrays sized from the same constants cannot drift apart.
Object.assign(ShaderChunk, {
  aphelion_color: colorChunk,
  aphelion_eclipse: eclipseChunk,
  aphelion_ray_sphere: raySphereChunk,
  aphelion_ring_scale_pars: ringScaleParsChunk,
  aphelion_ring_to_units: ringToUnitsChunk,
  aphelion_ring_to_km: ringToKmChunk,
  aphelion_sky_depth: skyDepthChunk,
});

// ---------------------------------------------------------------------------
// Body (planet / moon / dwarf) surface
// ---------------------------------------------------------------------------

export interface BodyMaterialOptions {
  map: Texture;
  nightMap?: Texture | null;
  normalMap?: Texture | null;
  specularMap?: Texture | null;
  /** Tint multiplied into the albedo. */
  tint?: number;
  /** Terminator/atmosphere rim colour; null disables the rim. */
  rimColor?: [number, number, number] | null;
  rimStrength?: number;
  /** Roughness for the specular lobe (only used where specularMap is set). */
  shininess?: number;
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
  };

  return new ShaderMaterial({
    defines: { MAX_OCCLUDERS },
    uniforms,
    vertexShader: bodyVertexShader,
    fragmentShader: bodyFragmentShader,
  });
}

// ---------------------------------------------------------------------------
// Cloud shell (Earth, Venus)
// ---------------------------------------------------------------------------

/**
 * Latitude samples in the zonal wind profile — 19, one every 10 degrees, index
 * 0 at the south pole. See `BodySpec.cloudWindMs`.
 */
export const ZONAL_SAMPLES = 19;

export function createCloudMaterial(map: Texture, opts: { opacity?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    defines: { MAX_OCCLUDERS, ZONAL_SAMPLES },
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      // Angular form of the wind profile: degrees of longitude per day at each
      // sampled latitude. Filled in by the renderer, which is where the body's
      // radius lives. Zero everywhere means a deck that does not shear.
      uZonalDeg: { value: Array.from({ length: ZONAL_SAMPLES }, () => 0) },
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
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
  });
}

// ---------------------------------------------------------------------------
// Atmosphere — single-scattering integration
// ---------------------------------------------------------------------------

export interface AtmosphereMaterialOptions {
  planetRadius: number;
  atmosphereRadius: number;
  rayleigh: [number, number, number];
  mie: number;
  density: number;
  /** View-ray march steps; 12 is plenty at these angular sizes. */
  steps?: number;
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
  return new ShaderMaterial({
    defines: { STEPS: opts.steps ?? 12, LIGHT_STEPS: 4 },
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
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
  });
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

export interface RingMaterialOptions {
  texture: Texture;
  /** Inner edge in true kilometres from the planet's centre. */
  innerKm: number;
  /** Outer edge in true kilometres from the planet's centre. */
  outerKm: number;
  opacity: number;
  parentRadiusKm: number;
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
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
  });
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
  profile: Texture;
  innerKm: number;
  outerKm: number;
  parentRadiusKm: number;
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
    vertexShader: ringParticleVertexShader,
    fragmentShader: ringParticleFragmentShader,
  });
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
    vertexShader: sunVertexShader,
    fragmentShader: sunFragmentShader,
  });
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
    vertexShader: coronaVertexShader,
    fragmentShader: coronaFragmentShader,
  });
}

// ---------------------------------------------------------------------------
// The sky
//
// Two layers on one camera-following sphere: the deep sky as a texture, and the
// Hipparcos stars as point sources on top. Both are pinned to the far plane by
// the same one-line trick, described on GLSL_SKY_DEPTH.
// ---------------------------------------------------------------------------

/**
 * The deep sky, as an equirectangular texture on the inside of a sphere.
 *
 * The sphere's own frame is ICRF/J2000 equatorial — the caller rotates it into
 * the ecliptic — so u = 0.5 is right ascension zero and v = 0 is the north
 * celestial pole.
 */
export function createSkyMaterial(
  map: Texture,
  opts: { brightness?: number } = {},
): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uMap: { value: prepare(map) },
      uBrightness: { value: opts.brightness ?? 1 },
    },
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
  });
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
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
  });
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
    vertexShader: swarmVertexShader,
    fragmentShader: swarmFragmentShader,
  });
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
    vertexShader: dustVertexShader,
    fragmentShader: dustFragmentShader,
  });
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
    vertexShader: orbitVertexShader,
    fragmentShader: orbitFragmentShader,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark a texture as already-linear so Three.js leaves it alone; every custom
 * shader above decodes sRGB itself. Keeps the colour pipeline in one place.
 */
function prepare(tex: Texture): Texture {
  tex.colorSpace = LinearSRGBColorSpace;
  return tex;
}

/** Push occluder data into a material's uniform array. */
export function setOccluders(
  material: ShaderMaterial,
  occluders: Array<{ x: number; y: number; z: number; radius: number }>,
): void {
  const slot = occluderSlots(material);
  if (slot === undefined) {
    return;
  }
  for (let i = 0; i < MAX_OCCLUDERS; i++) {
    const dst = slot[i];
    if (i < occluders.length) {
      const src = occluders[i];
      dst.set(src.x, src.y, src.z, src.radius);
    } else {
      dst.set(0, 0, 0, 0);
    }
  }
}
