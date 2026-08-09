/**
 * Scene assembly and the render loop's draw side.
 *
 * Three ideas hold this together:
 *
 * 1. **Floating origin.** Everything lives under a single group whose position
 *    is the negation of the focused body's scene position. So the focus is
 *    always at render-space (0,0,0) and float32 precision is spent where the
 *    camera actually is. Without this you cannot stand on a moon of Neptune.
 *
 * 2. **Tiered representation.** The Sun, planets, dwarf planets and moons above
 *    60 km get a textured sphere with its own material. The other ~600 bodies
 *    live in one point cloud, and are *promoted* to a real sphere on demand when
 *    you approach or select one. That keeps 690 simulated bodies affordable
 *    without pre-building 690 meshes and 450 procedural textures.
 *
 * 3. **Analytic shadows.** No shadow maps — they cannot span from ring particles
 *    to Neptune. Eclipses, ring shadows and planet-on-ring shadows are all
 *    solved in closed form in the shaders (see materials.ts).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Line,
  LineSegments,
  Matrix4,
  Mesh,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  type PerspectiveCamera,
  type Texture,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { AU_KM, SCENE_UNIT_KM, SUN_RADIUS_KM } from '../core/constants.ts'
import type { ScaleModel } from '../core/scale.ts'
import type { SimBody, SolarSystem } from '../core/system.ts'
import type { Basis } from '../astro/frames.ts'
import { buildSwarms } from '../data/belts.ts'
import { RELIEF_EXAGGERATION, type RingSpec } from '../data/bodies.ts'
import { reliefFor, type ReliefMap } from '../data/generated/relief.ts'
import {
  classifySurface,
  pointSprite,
  proceduralRing,
  ringProfile,
  proceduralSurface,
  seedFromName,
  solidTexture,
} from './procedural.ts'
import {
  createAtmosphereMaterial,
  createBodyMaterial,
  createCloudMaterial,
  createCoronaMaterial,
  createDustMaterial,
  createOrbitMaterial,
  createRingMaterial,
  createRingParticleMaterial,
  createSkyMaterial,
  createSunMaterial,
  createSwarmMaterial,
  MAX_OCCLUDERS,
} from './materials.ts'
import type { TextureLibrary } from './textures.ts'

export type Quality = 'low' | 'medium' | 'high'
export type OrbitMode = 'none' | 'planets' | 'all'
export type LabelMode = 'none' | 'major' | 'all'

/** Moons at or above this radius (km) get a full mesh from the start. */
const MAJOR_MOON_RADIUS = 60

/** Maximum minor bodies promoted to real geometry at once. */
const PROMOTION_SLOTS = 6

/**
 * Sphere tessellation per detail tier, swapped by apparent size.
 *
 * Relief displacement reads these too: its normals are differenced at the
 * spacing of whichever tier is drawn, so shading always describes the surface
 * actually on screen rather than detail the triangles cannot express.
 */
const LOD_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [24, 14],
  [48, 26],
  [96, 52],
  [192, 96],
]

const QUALITY: Record<Quality, { bloom: boolean; atmoSteps: number; maxPixelRatio: number; msaa: number; sphereBias: number }> = {
  low: { bloom: false, atmoSteps: 6, maxPixelRatio: 1, msaa: 0, sphereBias: 0.6 },
  medium: { bloom: true, atmoSteps: 10, maxPixelRatio: 1.5, msaa: 2, sphereBias: 0.85 },
  high: { bloom: true, atmoSteps: 14, maxPixelRatio: 2, msaa: 4, sphereBias: 1 },
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Unit sphere with the rotation pole along +z and an equirectangular parameter-
 * isation: u runs eastward, v from the north pole down.
 *
 * Three's own SphereGeometry puts the pole on +y and winds u the other way,
 * which would mirror every map and mis-place every prime meridian, so we build
 * our own.
 *
 * Note the 0.5 offset on u. Geometry longitude is measured east from the body's
 * prime meridian (+x in the body-fixed frame, per the IAU rotation model), but
 * an equirectangular map's left edge is 180 degrees *west* of that meridian.
 * Without the half-turn every planet is rendered rotated 180 degrees — which
 * looks perfectly plausible until you check a sub-solar point against the clock
 * and find noon over the wrong hemisphere.
 */
function createSphere(widthSegments: number, heightSegments: number): BufferGeometry {
  const w = Math.max(6, widthSegments)
  const h = Math.max(4, heightSegments)
  const count = (w + 1) * (h + 1)
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const indices: number[] = []

  let p = 0
  for (let j = 0; j <= h; j++) {
    const v = j / h
    const theta = v * Math.PI // 0 at north pole
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)
    for (let i = 0; i <= w; i++) {
      const u = i / w
      const lon = u * Math.PI * 2
      const x = sinT * Math.cos(lon)
      const y = sinT * Math.sin(lon)
      const z = cosT
      positions[p * 3] = x
      positions[p * 3 + 1] = y
      positions[p * 3 + 2] = z
      normals[p * 3] = x
      normals[p * 3 + 1] = y
      normals[p * 3 + 2] = z
      // See the note above: shift the map so u = 0.5 is the prime meridian.
      uvs[p * 2] = u + 0.5
      uvs[p * 2 + 1] = v
      p++
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i
      const b = a + 1
      const c = a + (w + 1)
      const d = c + 1
      if (j !== 0) indices.push(a, c, b)
      if (j !== h - 1) indices.push(b, c, d)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('uv', new BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

/**
 * Radial subdivisions per ring. Enough that the power-law remap reads as a
 * curve rather than a fan of chords, and cheap: the whole solar system's rings
 * come to about 3 MB of vertices.
 */
const RING_RADIAL_STEPS = 48

/** Instanced rocks in the camera-local ring patch. */
const RING_PARTICLE_COUNT = 80000

/**
 * Largest simulated step the ring clocks will take in one frame, seconds.
 *
 * Time in this app runs to a century per second, at which a literal treatment
 * spins every rock into a strobing blur — so past a point, more rate stops
 * adding information and starts destroying it. Spin saturates early, because a
 * tumbling rock reads as fast long before a shear flow does.
 */
const RING_ORBIT_MAX_RATE = 150
const RING_SPIN_MAX_RATE = 3.6

/**
 * Spin runs this many times faster than the clock it is driven by.
 *
 * Real ring particles turn about once in the time they take to orbit — 14 hours
 * at Saturn — so honest spin is invisible at any rate you would actually watch
 * the rings at. Shifting the whole mapping up by a minute-per-second puts the
 * tumble where it reads well at 1 sec/s, and the step cap above still catches
 * everything faster, so the ceiling is unchanged and nothing strobes.
 */
const RING_SPIN_TIME_SCALE = 60

/** Field half-extent, counted in particle radii. Sets how dense the field looks. */
const RING_FIELD_IN_PARTICLES = 400

/** Field half-thickness, in particle radii. A ring is a sheet, not a slab. */
const RING_THICKNESS_IN_PARTICLES = 2.5

/**
 * Drawn radius of a ring particle, km.
 *
 * Pure exaggeration, and by a long way: real ring particles run from
 * centimetres to about ten metres, which is far below a pixel at any distance
 * this app can put you at, so drawing them honestly would draw nothing. The
 * size is pinned to the ring's own width instead, which keeps the field
 * looking similar whether you are in Saturn's main rings or Uranus's epsilon.
 */
function ringParticleSizeKm(spec: RingSpec): number {
  return Math.max((spec.outerKm - spec.innerKm) * 2e-4, 0.4)
}

/** GM in km^3/s^2, from the body's mass, for the local orbital rate. */
function gravitationalParameter(body: SimBody): number {
  const massKg = body.spec?.facts.mass ?? 0
  // 6.674e-20 is G in km^3 kg^-1 s^-2.
  const gm = massKg * 6.6743e-20
  return gm > 0 ? gm : 3.7931207e7
}

/**
 * Local kilometres per scene unit at a given rendered ring radius.
 *
 * Inverts the radial remap numerically rather than in closed form: the blended
 * power law has no analytic inverse, and this runs once per frame rather than
 * per vertex, so a short bisection is cheaper to trust than to be clever about.
 */
function ringKmPerUnit(radiusUnits: number, parentRadiusKm: number, scale: ScaleModel): number {
  if (radiusUnits <= 0) return SCENE_UNIT_KM
  let lo = 1
  let hi = parentRadiusKm * 400
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) * 0.5
    if (scale.satelliteDistance(mid, parentRadiusKm) < radiusUnits) lo = mid
    else hi = mid
  }
  return (lo + hi) * 0.5 / radiusUnits
}

/**
 * A patch of instanced rocks. `position` is a unit sphere the vertex shader
 * deforms per instance; everything about where a rock *is* comes from its slot
 * attributes, so the buffer is uploaded once and never touched again.
 */
function createRingParticleGeometry(count: number): InstancedBufferGeometry {
  const base = createSphere(6, 4)
  const geo = new InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.instanceCount = count

  const offsets = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  // Deterministic, so a ring looks the same every time you fly back into it.
  let state = 0x9e3779b9
  const rnd = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = rnd() * 2 - 1
    offsets[i * 3 + 1] = rnd() * 2 - 1
    // Concentrated toward the ring plane: a ring is not a uniform slab.
    offsets[i * 3 + 2] = (rnd() + rnd() + rnd() - 1.5) / 1.5
    seeds[i] = rnd()
  }
  geo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3))
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))
  return geo
}

/**
 * Flat annulus in the xy plane, for ring systems, parameterised in true
 * kilometres.
 *
 * `position` holds only the unit direction around the ring; the real radius
 * rides alongside in `aRingKm` and the vertex shader turns one into the other.
 * That split is what lets a single geometry serve both scale models without a
 * rebuild, and what keeps the profile registered to kilometres rather than to
 * whatever the radial remap did to them.
 *
 * Subdivided radially because that remap is a power law. Two rings of vertices
 * would draw the curve as a chord — at Saturn, a 66,000 km wide annulus drawn
 * as a single span misplaces its middle by tens of scene units, which is the
 * width of several gaps.
 */
function createAnnulus(
  innerKm: number,
  outerKm: number,
  segments: number,
  radialSteps: number,
): BufferGeometry {
  const seg = Math.max(48, segments)
  const steps = Math.max(2, radialSteps)
  const count = (seg + 1) * (steps + 1)
  const positions = new Float32Array(count * 3)
  const radii = new Float32Array(count)
  const indices: number[] = []

  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    for (let j = 0; j <= steps; j++) {
      const v = i * (steps + 1) + j
      const o = v * 3
      positions[o] = cos
      positions[o + 1] = sin
      positions[o + 2] = 0
      radii[v] = innerKm + ((outerKm - innerKm) * j) / steps
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < steps; j++) {
      const a = i * (steps + 1) + j
      const b = (i + 1) * (steps + 1) + j
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('aRingKm', new BufferAttribute(radii, 1))
  geo.setIndex(indices)
  // No normals: the ring shader takes its normal from the pole uniform, since a
  // flat sheet's vertex normals say nothing the plane's own normal does not.
  return geo
}

/** Load an orthonormal basis into a rotation matrix. */
function basisToMatrix(basis: Basis, out: Matrix4): Matrix4 {
  return out.set(
    basis.x.x, basis.y.x, basis.z.x, 0,
    basis.x.y, basis.y.y, basis.z.y, 0,
    basis.x.z, basis.y.z, basis.z.z, 0,
    0, 0, 0, 1,
  )
}

/** A rotation whose z axis is `pole` — used for ring planes. */
function poleMatrix(pole: { x: number; y: number; z: number }, out: Matrix4): Matrix4 {
  const z = new Vector3(pole.x, pole.y, pole.z).normalize()
  const helper = Math.abs(z.z) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)
  const x = new Vector3().crossVectors(helper, z).normalize()
  const y = new Vector3().crossVectors(z, x)
  return out.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1)
}

// ---------------------------------------------------------------------------
// Per-body visual
// ---------------------------------------------------------------------------

interface RingVisual {
  mesh: Mesh
  material: ShaderMaterial
  spec: RingSpec
}

interface BodyVisual {
  body: SimBody
  group: Group
  mesh: Mesh
  material: ShaderMaterial
  clouds: Mesh | null
  cloudMaterial: ShaderMaterial | null
  atmosphere: Mesh | null
  atmosphereMaterial: ShaderMaterial | null
  rings: RingVisual[]
  /** Currently selected level-of-detail index. */
  lod: number
  /**
   * True when this body has no real imagery and is still showing its flat
   * placeholder. The procedural surface is synthesised on demand, once the body
   * is actually big enough on screen to show it.
   */
  pendingProcedural: boolean
  /**
   * Published elevation grid for this body, once it has loaded. Null for the
   * great majority, which render as their reference ellipsoid.
   */
  relief: ReliefMap | null
  /** Exaggeration to apply at explore scale; 1 leaves relief true.  */
  reliefExaggeration: number
}

// ---------------------------------------------------------------------------
// SceneView
// ---------------------------------------------------------------------------

export interface SceneToggles {
  orbits: OrbitMode
  labels: LabelMode
  belts: boolean
  rings: boolean
  atmospheres: boolean
  milkyway: boolean
  minorBodies: boolean
}

export class SceneView {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly world = new Group()

  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private renderPass: RenderPass | null = null

  private library: TextureLibrary
  private quality: Quality = 'high'

  private lodGeometries: BufferGeometry[] = []

  private sky: Mesh | null = null
  private sunVisual: BodyVisual | null = null
  private coronaMesh: Mesh | null = null
  private coronaMaterial: ShaderMaterial | null = null

  private visuals = new Map<string, BodyVisual>()
  private promoted = new Map<string, BodyVisual>()
  private promotionPool: BodyVisual[] = []

  private minorPoints: Points | null = null
  private minorBodies: SimBody[] = []
  private minorPositions: Float32Array = new Float32Array(0)
  private minorSizes: Float32Array = new Float32Array(0)

  private swarmPoints: Points | null = null
  private swarmMaterial: ShaderMaterial | null = null

  private orbitGroup = new Group()
  private orbitLines = new Map<string, { line: Line; material: ShaderMaterial }>()
  private dust: LineSegments | null = null
  private dustMaterial: ShaderMaterial | null = null
  private orbitRebuildTimer = 0

  private labelHost: HTMLElement | null = null
  private labelPool: HTMLElement[] = []

  /** Render-space origin: the focused body's scene position. */
  private origin = new Vector3()
  private sunRender = new Vector3()

  toggles: SceneToggles = {
    orbits: 'planets',
    labels: 'major',
    belts: true,
    rings: true,
    atmospheres: true,
    milkyway: true,
    minorBodies: true,
  }

  selected: SimBody | null = null

  /**
   * Per-frame cache of the focused body, refreshed from the argument to
   * update(). Private: the camera owns the focus, and a third writable copy of
   * it here would be a third thing that could disagree.
   */
  private currentFocus: SimBody | null = null

  /** Procedural textures allowed to be generated this frame. */
  private proceduralBudget = 0

  private tmpMatrix = new Matrix4()
  private tmpVec = new Vector3()
  private tmpVec2 = new Vector3()
  private tmpVec3 = new Vector3()
  private viewport = new Vector2(1, 1)

  constructor(canvas: HTMLCanvasElement, library: TextureLibrary) {
    this.library = library

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // handled by the composer's multisampled target
      powerPreference: 'high-performance',
      // The scene spans eleven orders of magnitude; a logarithmic depth buffer
      // is the only thing that keeps a ring particle and Neptune in one image.
      logarithmicDepthBuffer: true,
      stencil: false,
    })
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0

    this.library.setAnisotropy(this.renderer.capabilities.getMaxAnisotropy())

    this.scene.add(this.world)
    this.world.add(this.orbitGroup)

    // Detail tiers, swapped by apparent size.
    this.lodGeometries = LOD_SEGMENTS.map(([w, h]) => createSphere(w!, h!))
  }

  // -- setup ---------------------------------------------------------------

  setLabelHost(host: HTMLElement): void {
    this.labelHost = host
  }

  setQuality(quality: Quality): void {
    this.quality = quality
    const q = QUALITY[quality]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio))
    if (this.bloom) this.bloom.enabled = q.bloom
    for (const visual of this.visuals.values()) {
      if (visual.atmosphereMaterial) {
        visual.atmosphereMaterial.visible = this.toggles.atmospheres
      }
    }
    this.rebuildComposer()
  }

  /** Build every persistent object in the scene. */
  build(system: SolarSystem): void {
    this.buildSky()
    this.buildSun(system.sun)

    for (const body of system.bodies) {
      if (body === system.sun) continue
      if (body.spec) {
        this.visuals.set(body.key, this.createVisual(body))
      } else if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) {
        this.visuals.set(body.key, this.createVisual(body))
      }
    }

    // Everything that did not get its own mesh.
    this.minorBodies = system.bodies.filter(
      (b) => b !== system.sun && !this.visuals.has(b.key),
    )
    this.buildMinorPoints()
    this.buildSwarms()
    this.buildRingParticles()
    this.buildDust()
    this.buildPromotionPool()
    this.rebuildComposer()
  }

  private buildSky(): void {
    const geo = createSphere(64, 32)
    const file = 'milkyway.jpg'
    const material = createSkyMaterial(solidTexture(0x05070c), { brightness: 0.55 })
    const mesh = new Mesh(geo, material)
    mesh.frustumCulled = false
    // Drawn first, never occluding anything.
    mesh.renderOrder = -1000
    mesh.scale.setScalar(1)
    this.sky = mesh
    // The sky rides with the camera, so it must not sit under the world group.
    this.scene.add(mesh)

    void this.library.load(file).then((tex) => {
      if (tex) {
        tex.flipY = false
        material.uniforms.uMap!.value = tex
        material.needsUpdate = true
      }
    })
  }

  private buildSun(sun: SimBody): void {
    const group = new Group()
    const material = createSunMaterial(null)
    const mesh = new Mesh(this.lodGeometries[2]!, material)
    group.add(mesh)

    // Corona shell, generously oversized and additive.
    this.coronaMaterial = createCoronaMaterial()
    this.coronaMesh = new Mesh(this.lodGeometries[1]!, this.coronaMaterial)
    this.coronaMesh.renderOrder = 5
    group.add(this.coronaMesh)

    this.world.add(group)
    this.sunVisual = {
      body: sun,
      group,
      mesh,
      material,
      clouds: null,
      cloudMaterial: null,
      atmosphere: null,
      atmosphereMaterial: null,
      rings: [],
      lod: 2,
      // The Sun always has its own imagery, and never a procedural stand-in.
      pendingProcedural: false,
      relief: null,
      reliefExaggeration: 1,
    }

    void this.library.load('sun.jpg').then((tex) => {
      if (!tex) return
      tex.flipY = false
      material.uniforms.uMap!.value = tex
      material.uniforms.uHasMap!.value = 1
      material.needsUpdate = true
    })
  }

  /** Build a full sphere visual (mesh + optional clouds, atmosphere, rings). */
  private createVisual(body: SimBody): BodyVisual {
    const group = new Group()

    // Start flat, in the body's own colour, so nothing is ever black and boot
    // never blocks. Real imagery is swapped in when it downloads; bodies with no
    // imagery get a procedural surface synthesised lazily (see updateVisual).
    const spec = body.spec
    const material = createBodyMaterial({
      map: solidTexture(body.color),
      // Only set where a panchromatic source needs colourising.
      tint: spec?.textureTint ?? 0xffffff,
      rimColor: spec?.atmosphere ? spec.atmosphere.groundTint : null,
      rimStrength: spec?.atmosphere ? 0.5 : 0,
      shininess: 70,
    })
    const mesh = new Mesh(this.lodGeometries[1]!, material)
    group.add(mesh)

    const visual: BodyVisual = {
      body,
      group,
      mesh,
      material,
      clouds: null,
      cloudMaterial: null,
      atmosphere: null,
      atmosphereMaterial: null,
      rings: [],
      lod: 1,
      pendingProcedural: false,
      relief: null,
      reliefExaggeration: RELIEF_EXAGGERATION[body.key] ?? 1,
    }

    // Published topography, if this body has any. The uniforms stay off until
    // the map is decoded, so the body is a correct ellipsoid in the meantime
    // rather than a briefly deformed one.
    const relief = reliefFor(body.key)
    if (relief) {
      void this.library.loadRelief(relief.file).then((tex) => {
        if (!tex) return
        const u = material.uniforms
        u.uRelief!.value = tex
        u.uReliefMinKm!.value = relief.minKm
        u.uReliefSpanKm!.value = relief.maxKm - relief.minKm
        // uReliefStep follows the drawn LOD and is set per frame in updateVisual.
        u.uHasRelief!.value = 1
        visual.relief = relief
        material.needsUpdate = true
      })
    }

    // Real imagery, if we have any for this body.
    const mapFile = body.textureFile
    if (mapFile && this.library.available(mapFile)) {
      void this.library.load(mapFile).then((tex) => {
        if (!tex) return
        material.uniforms.uMap!.value = tex
        material.needsUpdate = true
      })
    } else {
      visual.pendingProcedural = true
    }
    if (spec?.textures) {
      this.attachOptionalMap(material, spec.textures.night, 'uNightMap', 'uHasNight')
      this.attachOptionalMap(material, spec.textures.normal, 'uNormalMap', 'uHasNormal')
      this.attachOptionalMap(material, spec.textures.specular, 'uSpecularMap', 'uHasSpecular')

      // Cloud shell.
      if (spec.textures.clouds && this.library.available(spec.textures.clouds)) {
        // Black placeholder: the shader reads cover from brightness, so an
        // all-black map means "no cloud" and discards until the real one lands.
        const cloudMaterial = createCloudMaterial(solidTexture(0x000000), {
          opacity: body.key === 'venus' ? 1 : 0.9,
        })
        const clouds = new Mesh(this.lodGeometries[1]!, cloudMaterial)
        clouds.scale.setScalar(1.004)
        clouds.renderOrder = 2
        group.add(clouds)
        visual.clouds = clouds
        visual.cloudMaterial = cloudMaterial
        void this.library.load(spec.textures.clouds).then((tex) => {
          if (!tex) return
          tex.flipY = false
          cloudMaterial.uniforms.uMap!.value = tex
          cloudMaterial.needsUpdate = true
        })
      }
    }

    // Atmosphere shell.
    if (spec?.atmosphere) {
      const atmo = spec.atmosphere
      const shellRatio = 1 + (atmo.thicknessKm * 5) / body.radiusKm
      const atmoMaterial = createAtmosphereMaterial({
        planetRadius: 1,
        atmosphereRadius: shellRatio,
        rayleigh: atmo.rayleigh,
        mie: atmo.mie,
        density: atmo.density,
        steps: QUALITY[this.quality].atmoSteps,
      })
      const shell = new Mesh(this.lodGeometries[1]!, atmoMaterial)
      shell.scale.setScalar(shellRatio)
      shell.renderOrder = 3
      group.add(shell)
      visual.atmosphere = shell
      visual.atmosphereMaterial = atmoMaterial
    }

    // Rings.
    if (spec?.rings) {
      for (const ring of spec.rings) {
        // Published radial structure wins over noise. It is also the stand-in
        // while Saturn's photometric strip loads, so the gaps never jump.
        let texture: Texture
        if (ring.bands) {
          texture = ringProfile(`ring:${body.key}:${ring.name}`, {
            bands: ring.bands,
            innerKm: ring.innerKm,
            outerKm: ring.outerKm,
          })
        } else {
          texture = proceduralRing(`ring:${body.key}:${ring.name}`, {
            color: ring.opacity > 0.1 ? 0xbfae92 : 0x8f8878,
            seed: seedFromName(`${body.key}${ring.name}`),
            gaps: 3,
            sharpness: 3.2,
          })
        }
        const material = createRingMaterial({
          texture,
          innerKm: ring.innerKm,
          outerKm: ring.outerKm,
          opacity: ring.opacity,
          parentRadiusKm: body.radiusKm,
        })
        const mesh = new Mesh(createAnnulus(ring.innerKm, ring.outerKm, 512, RING_RADIAL_STEPS), material)
        // The shader places vertices in scene units itself, so the mesh must
        // not also be scaled by the body radius the way the sphere is.
        mesh.scale.setScalar(1)
        // ...which also means the geometry's own bounds describe a unit circle
        // rather than the ring. Left to cull itself, a ring would vanish the
        // moment the planet's centre left the screen — precisely when you are
        // flying through it.
        mesh.frustumCulled = false
        mesh.renderOrder = 4
        group.add(mesh)
        visual.rings.push({ mesh, material, spec: ring })

        if (ring.texture && this.library.available(ring.texture)) {
          void this.library.load(ring.texture).then((tex) => {
            if (!tex) return
            tex.flipY = false
            material.uniforms.uTex!.value = tex
            material.needsUpdate = true
          })
        }
      }
    }

    this.world.add(group)
    return visual
  }

  private attachOptionalMap(
    material: ShaderMaterial,
    file: string | undefined,
    slot: string,
    flag: string,
  ): void {
    if (!file || !this.library.available(file)) return
    void this.library.load(file).then((tex) => {
      if (!tex) return
      tex.flipY = false
      material.uniforms[slot]!.value = tex
      material.uniforms[flag]!.value = 1
      material.needsUpdate = true
    })
  }

  private buildMinorPoints(): void {
    const n = this.minorBodies.length
    this.minorPositions = new Float32Array(n * 3)
    this.minorSizes = new Float32Array(n)
    const colors = new Float32Array(n * 3)
    const c = new Color()
    for (let i = 0; i < n; i++) {
      c.set(this.minorBodies[i]!.color)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      this.minorSizes[i] = 1
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.minorPositions, 3))
    geo.setAttribute('aColor', new BufferAttribute(colors, 3))
    geo.setAttribute('aSize', new BufferAttribute(this.minorSizes, 1))

    const pointsMaterial = createMinorPointsMaterial(pointSprite())
    const points = new Points(geo, pointsMaterial)
    points.frustumCulled = false
    points.renderOrder = 6
    this.world.add(points)
    this.minorPoints = points
  }

  private buildSwarms(): void {
    const data = buildSwarms()
    const geo = new BufferGeometry()
    // Position is unused (the vertex shader derives it) but Three requires it.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(data.total * 3), 3))
    geo.setAttribute('aA', new BufferAttribute(data.a, 1))
    geo.setAttribute('aE', new BufferAttribute(data.e, 1))
    geo.setAttribute('aInc', new BufferAttribute(data.inc, 1))
    geo.setAttribute('aNode', new BufferAttribute(data.node, 1))
    geo.setAttribute('aPeri', new BufferAttribute(data.argPeri, 1))
    geo.setAttribute('aM0', new BufferAttribute(data.m0, 1))
    geo.setAttribute('aN', new BufferAttribute(data.n, 1))
    geo.setAttribute('aSize', new BufferAttribute(data.size, 1))
    geo.setAttribute('aColor', new BufferAttribute(data.color, 3))

    const material = createSwarmMaterial(pointSprite())
    const points = new Points(geo, material)
    points.frustumCulled = false
    points.renderOrder = 7
    this.world.add(points)
    this.swarmPoints = points
    this.swarmMaterial = material
  }

  private buildPromotionPool(): void {
    for (let i = 0; i < PROMOTION_SLOTS; i++) {
      const group = new Group()
      const material = createBodyMaterial({ map: solidTexture(0x808080) })
      const mesh = new Mesh(this.lodGeometries[1]!, material)
      group.add(mesh)
      group.visible = false
      this.world.add(group)
      this.promotionPool.push({
        body: null as unknown as SimBody,
        group,
        mesh,
        material,
        clouds: null,
        cloudMaterial: null,
        atmosphere: null,
        atmosphereMaterial: null,
        rings: [],
        lod: 1,
        pendingProcedural: false,
        // Assigned per body when the slot is claimed, since these are recycled.
        relief: null,
        reliefExaggeration: 1,
      })
    }
  }

  /**
   * Build the travel dust: a fixed cloud of unit-cube positions, two vertices
   * per particle so the vertex shader can drag one end into a streak.
   *
   * Added to the scene root rather than to the world group, because it lives in
   * camera-relative space and must not be moved by the floating origin.
   */
  private buildDust(): void {
    const count = 700
    const positions = new Float32Array(count * 2 * 3)
    const ends = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const x = Math.random()
      const y = Math.random()
      const z = Math.random()
      for (let end = 0; end < 2; end++) {
        const v = i * 2 + end
        positions[v * 3] = x
        positions[v * 3 + 1] = y
        positions[v * 3 + 2] = z
        ends[v] = end
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('aEnd', new BufferAttribute(ends, 1))

    this.dustMaterial = createDustMaterial()
    this.dust = new LineSegments(geo, this.dustMaterial)
    this.dust.frustumCulled = false
    this.dust.renderOrder = 8
    this.dust.visible = false
    this.scene.add(this.dust)
  }

  /**
   * Point the dust at wherever the camera is and however fast it is going.
   *
   * The cell is sized from the distance covered per second, so the field is
   * always dense enough to read as motion and never so dense it becomes fog.
   */
  updateDust(position: Vector3, velocity: Vector3, dt: number, intensity: number): void {
    if (!this.dust || !this.dustMaterial) return

    const perSecond = velocity.length()
    // Nothing to draw when parked, and the field is pure noise on a still
    // image — a streak shorter than a pixel is just a speck in the way.
    const show = intensity > 0.01 && perSecond > 1e-6
    this.dust.visible = show
    if (!show) return

    const u = this.dustMaterial.uniforms
    u.uCamPos!.value.copy(position)
    u.uStreak!.value.copy(velocity).multiplyScalar(dt)
    // Roughly one second of travel across the cell, so the density reads the
    // same whether the motion is kilometres or AU per second.
    u.uCell!.value = Math.max(perSecond * 1.4, 1e-4)
    u.uIntensity!.value = intensity
  }

  private rebuildComposer(): void {
    const q = QUALITY[this.quality]
    const size = this.renderer.getDrawingBufferSize(new Vector2())
    const width = Math.max(1, size.x)
    const height = Math.max(1, size.y)

    this.composer?.dispose()

    const target = new WebGLRenderTarget(width, height, {
      samples: q.msaa,
      colorSpace: SRGBColorSpace,
    })
    const composer = new EffectComposer(this.renderer, target)
    composer.setSize(width, height)

    this.renderPass = new RenderPass(this.scene, this.currentCamera!)
    composer.addPass(this.renderPass)

    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.55, 0.65, 0.72)
    this.bloom.enabled = q.bloom
    composer.addPass(this.bloom)

    composer.addPass(new OutputPass())
    this.composer = composer
  }

  /** Camera used for rendering; set by the app each frame. */
  private ringParticles: Mesh | null = null
  private ringParticleMaterial: ShaderMaterial | null = null
  /**
   * Simulated seconds driving ring particle motion, kept as two clocks.
   *
   * Both advance with the *simulation* clock rather than the wall clock, so
   * pausing genuinely stops the rings and running time backwards unwinds them.
   * Both are also rate-limited per frame, which is the whole reason they are
   * separate: at a day per second the true orbital shear is a blur and the
   * tumble is a strobe, so each gets the cap that keeps it legible. Shear can
   * take a much larger step than spin before it stops reading as motion.
   */
  private ringOrbitClock = 0
  private ringSpinClock = 0
  /** Previous TT Julian Date, for measuring how much simulated time passed. */
  private lastRingJdTT: number | null = null

  /**
   * Whether individual ring particles are on screen.
   *
   * The frame governor needs this. It idles at 10 fps unless the clock is
   * moving fast enough to shift a planet, which is the right call for a solar
   * system — but ring particles spin and shear at 1 sec/s, where nothing else
   * does, and at 10 fps that reads as a stutter rather than as motion.
   */
  get ringParticlesActive(): boolean {
    return this.ringParticles?.visible === true
  }

  currentCamera: PerspectiveCamera | null = null

  // -- per-frame -----------------------------------------------------------

  update(
    system: SolarSystem,
    scale: ScaleModel,
    focus: SimBody,
    elapsedSeconds: number,
    dt: number,
  ): void {
    this.currentFocus = focus
    this.proceduralBudget = 1

    // Floating origin.
    this.origin.set(focus.scene.x, focus.scene.y, focus.scene.z)
    this.world.position.set(-this.origin.x, -this.origin.y, -this.origin.z)

    // The Sun in render space.
    this.sunRender.set(-this.origin.x, -this.origin.y, -this.origin.z)
    const sunSceneRadius = system.sun.sceneRadius

    this.updateSun(system.sun, elapsedSeconds)

    for (const visual of this.visuals.values()) {
      this.updateVisual(visual, scale, sunSceneRadius)
    }

    this.advanceRingClocks(system.jdTT, dt)
    this.updateRingParticles(scale, sunSceneRadius)
    this.updatePromotions(scale, sunSceneRadius)
    this.updateMinorPoints()
    this.updateSwarms(system, scale)
    this.updateOrbits(system, scale, dt)
    this.updateSky()
    this.updateLabels(system)
  }

  private updateSun(sun: SimBody, elapsedSeconds: number): void {
    const visual = this.sunVisual
    if (!visual) return
    visual.group.position.set(sun.scene.x, sun.scene.y, sun.scene.z)
    basisToMatrix(sun.orientation, this.tmpMatrix)
    visual.mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)
    visual.mesh.scale.setScalar(sun.sceneRadius)
    visual.material.uniforms.uTime!.value = elapsedSeconds

    if (this.coronaMesh && this.coronaMaterial) {
      // The corona is drawn on a shell far larger than the photosphere.
      const outer = sun.sceneRadius * 4.5
      this.coronaMesh.scale.setScalar(outer)
      this.coronaMaterial.uniforms.uCentre!.value.copy(this.sunRender)
      this.coronaMaterial.uniforms.uInner!.value = sun.sceneRadius * 0.98
      this.coronaMaterial.uniforms.uOuter!.value = outer
      this.coronaMaterial.uniforms.uIntensity!.value = 0.55
    }
  }

  private updateVisual(visual: BodyVisual, scale: ScaleModel, sunSceneRadius: number): void {
    const body = visual.body
    const group = visual.group
    group.position.set(body.scene.x, body.scene.y, body.scene.z)

    const radius = body.sceneRadius
    const squash = 1 - body.flattening

    // The cloud deck sits 0.4% of a radius up, which is roughly right for Earth
    // until relief is exaggerated 25-fold and the Himalayas stand four times
    // higher than the clouds. Lift the shell just enough to clear the peaks.
    let cloudLift = 1.004
    if (visual.relief) {
      // Model space is the unit sphere, so one unit of displacement is one body
      // radius: dividing the elevation by the true radius keeps relief in
      // proportion, and it then rides whatever scaling the body itself gets.
      const exaggeration = scale.reliefExaggeration(visual.reliefExaggeration)
      const u = visual.material.uniforms
      u.uReliefScale!.value = exaggeration / body.radiusKm
      const seg = LOD_SEGMENTS[visual.lod] ?? LOD_SEGMENTS[0]!
      u.uReliefStep!.value.set(1 / seg[0], 1 / seg[1])
      cloudLift = Math.max(
        cloudLift,
        1 + (visual.relief.maxKm * exaggeration * 1.05) / body.radiusKm,
      )
    }

    basisToMatrix(body.orientation, this.tmpMatrix)
    visual.mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)
    visual.mesh.scale.set(radius, radius, radius * squash)

    if (visual.clouds) {
      visual.clouds.quaternion.copy(visual.mesh.quaternion)
      visual.clouds.scale.set(radius * cloudLift, radius * cloudLift, radius * cloudLift * squash)
    }
    if (visual.atmosphere) {
      const ratio = (visual.atmosphere.userData.shellRatio as number | undefined) ?? null
      void ratio
      visual.atmosphere.quaternion.copy(visual.mesh.quaternion)
    }

    // Body centre in render space.
    this.tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.origin)
    const centre = this.tmpVec

    this.applyLighting(visual.material, body, centre, sunSceneRadius, scale)
    if (visual.cloudMaterial) {
      const u = visual.cloudMaterial.uniforms
      u.uSunPos!.value.copy(this.sunRender)
      u.uSunRadius!.value = sunSceneRadius
      u.uBodyCentre!.value.copy(centre)
      u.uKmPerUnit!.value = body.radiusKm / Math.max(body.sceneRadius, 1e-9)
      this.setEclipseUniforms(visual.cloudMaterial, body)
    }
    if (visual.atmosphereMaterial) {
      const u = visual.atmosphereMaterial.uniforms
      const shellRatio = visual.atmosphere ? visual.atmosphere.scale.x / Math.max(radius, 1e-9) : 1
      void shellRatio
      u.uCentre!.value.copy(centre)
      u.uPlanetRadius!.value = radius
      u.uAtmoRadius!.value = visual.atmosphere ? visual.atmosphere.scale.x : radius
      u.uSunPos!.value.copy(this.sunRender)
      u.uSunRadius!.value = sunSceneRadius
      visual.atmosphere!.visible = this.toggles.atmospheres
    }

    // Rings sit in the body's equatorial plane and do not spin with it.
    //
    // The radial remap is handed to the shader rather than baked into the mesh
    // scale, because a ring is a population of orbiting bodies and has to be
    // compressed exactly as the moons are — see GLSL_RING_SCALE_PARS.
    for (const ring of visual.rings) {
      ring.mesh.visible = this.toggles.rings
      poleMatrix(body.orientation.z, this.tmpMatrix)
      ring.mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)
      const u = ring.material.uniforms
      u.uSunPos!.value.copy(this.sunRender)
      u.uSunRadius!.value = sunSceneRadius
      u.uPlanetCentre!.value.copy(centre)
      u.uPlanetRadius!.value = radius
      u.uParentRadiusKm!.value = body.radiusKm
      u.uBodyScale!.value = scale.params.bodyScale
      u.uSatExponent!.value = scale.params.satelliteExponent
      u.uSatKnee!.value = scale.params.satelliteKnee
      u.uScaleBlend!.value = scale.blendAmount
      u.uSceneUnitKm!.value = SCENE_UNIT_KM
      u.uExploreBoost!.value = ring.spec.exploreBoost ?? 1
      u.uExploreBrightness!.value = ring.spec.exploreBrightness ?? 1
      this.tmpVec2.set(body.orientation.z.x, body.orientation.z.y, body.orientation.z.z)
      u.uNormal!.value.copy(this.tmpVec2)
    }

    // Ring shadow cast onto the planet itself.
    //
    // Pick the ring that actually blocks light rather than rings[0]: for
    // Jupiter that was the Halo, a dust sheet of optical depth 0.035 which was
    // shadowing the planet as hard as Saturn's B ring because the lookup read
    // the profile's alpha and ignored the ring's own opacity entirely.
    const mainRing = this.densestRing(visual)
    if (mainRing && this.toggles.rings) {
      const u = visual.material.uniforms
      u.uRingEnabled!.value = 1
      u.uRingTex!.value = mainRing.material.uniforms.uTex!.value
      u.uRingInnerKm!.value = mainRing.spec.innerKm
      u.uRingOuterKm!.value = mainRing.spec.outerKm
      u.uRingOpacity!.value = mainRing.spec.opacity
      u.uRingNormal!.value.set(body.orientation.z.x, body.orientation.z.y, body.orientation.z.z)
      u.uParentRadiusKm!.value = body.radiusKm
      u.uBodyScale!.value = scale.params.bodyScale
      u.uSatExponent!.value = scale.params.satelliteExponent
      u.uSatKnee!.value = scale.params.satelliteKnee
      u.uScaleBlend!.value = scale.blendAmount
      u.uSceneUnitKm!.value = SCENE_UNIT_KM
    } else {
      visual.material.uniforms.uRingEnabled!.value = 0
    }

    // Level of detail from apparent size.
    const camera = this.currentCamera
    if (camera) {
      const distance = Math.max(camera.position.distanceTo(centre), 1e-6)
      const apparent = (radius / distance) * this.viewport.y * QUALITY[this.quality].sphereBias
      // Synthesise the procedural surface the first time a body is actually big
      // enough to show one, capped at one per frame. Most of the ~450 bodies
      // without imagery never get close enough to need one, so this turns a
      // multi-second boot stall into work that is never done at all.
      if (visual.pendingProcedural && apparent > 4 && this.proceduralBudget > 0) {
        this.proceduralBudget--
        visual.pendingProcedural = false
        visual.material.uniforms.uMap!.value = proceduralSurface(`body:${body.key}`, {
          color: body.color,
          radiusKm: body.radiusKm,
          surface:
            body.key === 'io'
              ? 'sulfurous'
              : classifySurface({
                  parentKey: body.parent?.key ?? null,
                  name: body.name,
                  radiusKm: body.radiusKm,
                  isMoon: body.type === 'moon',
                }),
          seed: seedFromName(body.key),
        })
        visual.material.needsUpdate = true
      }

      const lod = apparent > 260 ? 3 : apparent > 70 ? 2 : apparent > 16 ? 1 : 0
      if (lod !== visual.lod) {
        visual.lod = lod
        visual.mesh.geometry = this.lodGeometries[lod]!
        if (visual.clouds) visual.clouds.geometry = this.lodGeometries[Math.max(1, lod)]!
        if (visual.atmosphere) visual.atmosphere.geometry = this.lodGeometries[Math.max(1, lod)]!
      }
      // Hide anything smaller than a fraction of a pixel; the point cloud and
      // labels still represent it.
      visual.group.visible = apparent > 0.35 || body === this.currentFocus || body === this.selected
    }
  }

  /**
   * Move the ring clocks by however much simulated time just passed.
   *
   * Measured from the Julian Date rather than taken from the frame's dt, so it
   * follows the clock's rate and sign for free and needs no knowledge of
   * either. A paused clock advances nothing, which is what stops the rocks.
   */
  private advanceRingClocks(jdTT: number, dt: number): void {
    const previous = this.lastRingJdTT
    this.lastRingJdTT = jdTT
    if (previous === null) return
    const seconds = (jdTT - previous) * 86400
    const step = Math.max(dt, 1e-4)
    const clamp = (v: number, rate: number): number =>
      Math.max(-rate * step, Math.min(rate * step, v))
    this.ringOrbitClock += clamp(seconds, RING_ORBIT_MAX_RATE)
    this.ringSpinClock += clamp(seconds * RING_SPIN_TIME_SCALE, RING_SPIN_MAX_RATE)
  }

  /**
   * One patch, built once. Which ring it serves is decided per frame.
   *
   * It hangs off the world group rather than a body's group because it is
   * repositioned onto whichever ring has claimed it, and a body group already
   * carries that body's own position.
   */
  private buildRingParticles(): void {
    const material = createRingParticleMaterial({
      profile: solidTexture(0xffffff),
      innerKm: 1,
      outerKm: 2,
      parentRadiusKm: 1,
    })
    const mesh = new Mesh(createRingParticleGeometry(RING_PARTICLE_COUNT), material)
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.renderOrder = 4
    this.world.add(mesh)
    this.ringParticles = mesh
    this.ringParticleMaterial = material
  }

  /**
   * Populate the ring the camera is actually inside with real geometry.
   *
   * Only one patch exists in the whole scene, and it is claimed by whichever
   * ring the camera is nearest — you can only ever be inside one. It switches
   * ring by having its uniforms repointed, which costs nothing, so there is no
   * pool to manage and no allocation while flying.
   *
   * The patch stays off entirely unless the camera is close enough that a
   * particle would cover more than a pixel or so. Far away the sheet is not
   * merely cheaper, it is more correct: at that distance a real ring *is* a
   * smooth surface, and swapping in a few thousand boulders would misrepresent
   * it as gravel.
   */
  private updateRingParticles(scale: ScaleModel, sunSceneRadius: number): void {
    const mesh = this.ringParticles
    const material = this.ringParticleMaterial
    const camera = this.currentCamera
    if (!mesh || !material || !camera) return

    let best: { visual: BodyVisual; ring: RingVisual; distance: number } | null = null
    if (this.toggles.rings) {
      for (const visual of this.visuals.values()) {
        for (const ring of visual.rings) {
          if (!ring.spec.bands) continue
          // Distance from the camera to this ring's annulus, in scene units.
          this.tmpVec
            .set(visual.body.scene.x, visual.body.scene.y, visual.body.scene.z)
            .sub(this.origin)
          const toCam = this.tmpVec2.copy(camera.position).sub(this.tmpVec)
          const normal = this.tmpVec3.set(
            visual.body.orientation.z.x,
            visual.body.orientation.z.y,
            visual.body.orientation.z.z,
          )
          const height = Math.abs(toCam.dot(normal))
          const radial = Math.sqrt(Math.max(toCam.lengthSq() - height * height, 0))
          const innerU = scale.satelliteDistance(ring.spec.innerKm, visual.body.radiusKm)
          const outerU = scale.satelliteDistance(ring.spec.outerKm, visual.body.radiusKm)
          const radialGap = radial < innerU ? innerU - radial : radial > outerU ? radial - outerU : 0
          const distance = Math.hypot(height, radialGap)
          if (!best || distance < best.distance) best = { visual, ring, distance }
        }
      }
    }

    // How wide a patch has to be to fill the view, and how big a particle must
    // be drawn to be seen at all. Real ring particles are metres across, which
    // at any scale this app can show is far below a pixel, so the size is an
    // exaggeration — stated in the info panel, like the relief factor.
    // Turn on only once the camera is inside the field's own reach, so the
    // handover to the flat sheet happens exactly where the rocks run out
    // rather than at an unrelated distance.
    if (!best) {
      mesh.visible = false
      return
    }
    const outerUnits = scale.satelliteDistance(best.ring.spec.outerKm, best.visual.body.radiusKm)
    const unitsPerKm = outerUnits / best.ring.spec.outerKm
    const reach = ringParticleSizeKm(best.ring.spec) * RING_FIELD_IN_PARTICLES * unitsPerKm
    if (best.distance > reach) {
      mesh.visible = false
      return
    }

    const { visual, ring } = best
    const body = visual.body
    mesh.visible = true

    // Sit the patch in the ring's own plane, then express the camera in that
    // frame: radius, angle and height, all in true kilometres.
    // The patch hangs off the world group, whose own position carries the
    // floating origin — so like every other child here it takes the body's
    // *absolute* scene position. Subtracting the origin as well would shift it
    // by the offset twice, which is invisible whenever the Sun is focused and
    // wrong everywhere else.
    mesh.position.set(body.scene.x, body.scene.y, body.scene.z)
    this.tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.origin)
    poleMatrix(body.orientation.z, this.tmpMatrix)
    mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)

    this.tmpVec2.copy(camera.position).sub(this.tmpVec).applyQuaternion(mesh.quaternion.clone().invert())
    const radiusUnits = Math.hypot(this.tmpVec2.x, this.tmpVec2.y)
    const kmPerUnit = ringKmPerUnit(radiusUnits, body.radiusKm, scale)
    const camRadiusKm = Math.min(
      Math.max(radiusUnits * kmPerUnit, ring.spec.innerKm),
      ring.spec.outerKm,
    )
    const camAngle = Math.atan2(this.tmpVec2.y, this.tmpVec2.x)

    const u = material.uniforms
    u.uProfile!.value = ring.material.uniforms.uTex!.value
    u.uInnerKm!.value = ring.spec.innerKm
    u.uOuterKm!.value = ring.spec.outerKm
    u.uCamRing!.value.set(camRadiusKm, camAngle, 0)

    // Field extent and rock size are fixed in kilometres for a given ring, and
    // deliberately not tied to how far away the camera is. Sizing them by
    // distance is what made the rocks unreachable: the field shrank as you
    // approached at exactly the rate that kept every rock the same size on
    // screen, so closing on one achieved nothing.
    const particleKm = ringParticleSizeKm(ring.spec)
    const fieldKm = particleKm * RING_FIELD_IN_PARTICLES
    u.uPatchR!.value = fieldKm
    u.uPatchS!.value = fieldKm
    u.uPatchZ!.value = particleKm * RING_THICKNESS_IN_PARTICLES
    u.uParticleKm!.value = particleKm
    u.uTime!.value = this.ringOrbitClock
    u.uSpin!.value = this.ringSpinClock

    u.uGmKm!.value = gravitationalParameter(body)
    // Both in render space: the shader shades against vWorldPos, which the
    // model matrix has already carried out of the ring's local frame.
    u.uSunPos!.value.copy(this.sunRender)
    u.uPlanetCentre!.value.copy(this.tmpVec)
    u.uPlanetRadius!.value = body.sceneRadius
    u.uParentRadiusKm!.value = body.radiusKm
    u.uBodyScale!.value = scale.params.bodyScale
    u.uSatExponent!.value = scale.params.satelliteExponent
    u.uSatKnee!.value = scale.params.satelliteKnee
    u.uScaleBlend!.value = scale.blendAmount
    u.uSceneUnitKm!.value = SCENE_UNIT_KM
    void sunSceneRadius
  }

  /**
   * The ring that casts the shadow worth drawing.
   *
   * Only one ring can be handed to the body shader, and the list order is
   * inward-out, not densest-first. Jupiter's rings[0] is the Halo — a dust
   * sheet you can see stars through — while the Main ring five times denser
   * sits behind it in the list.
   */
  private densestRing(visual: BodyVisual): RingVisual | null {
    let best: RingVisual | null = null
    for (const ring of visual.rings) {
      if (!best || ring.spec.opacity > best.spec.opacity) best = ring
    }
    return best
  }

  private applyLighting(
    material: ShaderMaterial,
    body: SimBody,
    centre: Vector3,
    sunSceneRadius: number,
    scale: ScaleModel,
  ): void {
    void scale
    const u = material.uniforms
    u.uSunPos!.value.copy(this.sunRender)
    u.uSunRadius!.value = sunSceneRadius
    u.uBodyCentre!.value.copy(centre)
    u.uKmPerUnit!.value = body.radiusKm / Math.max(body.sceneRadius, 1e-9)

    // Illumination falloff.
    //
    // True irradiance goes as 1/r^2, which puts Saturn at 1% of Earth's
    // brightness and Neptune at 0.1% — rendered literally, the outer system is
    // black. Real eyes adapt; a fixed monitor does not. So we compress the
    // exponent, which keeps the *ordering* and a real sense of dimming while
    // leaving every planet visible. This is the one deliberately non-physical
    // constant in the renderer.
    const rKm = Math.max(Math.hypot(body.helioKm.x, body.helioKm.y, body.helioKm.z), 1)
    u.uSunIntensity!.value = Math.min(3, Math.pow(AU_KM / rKm, 0.45))

    // The Sun in body-centred kilometres.
    u.uSunPosKm!.value.set(-body.helioKm.x, -body.helioKm.y, -body.helioKm.z)
    u.uSunRadiusKm!.value = SUN_RADIUS_KM

    this.setEclipseUniforms(material, body)
  }

  /**
   * Pick the occluders that could actually eclipse this body and hand them to
   * the shader in body-centred kilometres.
   */
  private setEclipseUniforms(material: ShaderMaterial, body: SimBody): void {
    const slots = material.uniforms.uOccluders!.value as Vector4[]
    for (const slot of slots) slot.set(0, 0, 0, 0)

    const candidates: SimBody[] = []
    if (body.parent && body.parent.type !== 'star') candidates.push(body.parent)
    if (body.parent) {
      for (const sibling of body.parent.children) {
        if (sibling !== body && sibling.radiusKm > 40) candidates.push(sibling)
      }
    }
    for (const child of body.children) {
      if (child.radiusKm > 40) candidates.push(child)
    }
    if (candidates.length === 0) return

    // Rank by angular radius as seen from this body: the biggest are the only
    // ones that can meaningfully cover the solar disc.
    const scored = candidates
      .map((c) => {
        const dx = c.helioKm.x - body.helioKm.x
        const dy = c.helioKm.y - body.helioKm.y
        const dz = c.helioKm.z - body.helioKm.z
        const d = Math.max(Math.hypot(dx, dy, dz), 1)
        return { c, dx, dy, dz, angular: c.radiusKm / d }
      })
      .sort((a, b) => b.angular - a.angular)
      .slice(0, MAX_OCCLUDERS)

    for (let i = 0; i < scored.length; i++) {
      const s = scored[i]!
      slots[i]!.set(s.dx, s.dy, s.dz, s.c.radiusKm)
    }
  }

  /**
   * Promote the nearest / selected minor bodies to real spheres.
   *
   * Without this, flying to Vesta would show you a point sprite. With it, the
   * ~600 small bodies cost six meshes rather than six hundred.
   */
  private updatePromotions(scale: ScaleModel, sunSceneRadius: number): void {
    const camera = this.currentCamera
    if (!camera) return

    const wanted: { body: SimBody; apparent: number }[] = []
    for (const body of this.minorBodies) {
      this.tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.origin)
      const distance = Math.max(camera.position.distanceTo(this.tmpVec), 1e-9)
      const apparent = (body.sceneRadius / distance) * this.viewport.y
      if (apparent > 2.5 || body === this.selected || body === this.currentFocus) {
        wanted.push({ body, apparent: body === this.currentFocus ? 1e9 : apparent })
      }
    }
    wanted.sort((a, b) => b.apparent - a.apparent)
    const chosen = wanted.slice(0, PROMOTION_SLOTS)
    const chosenKeys = new Set(chosen.map((w) => w.body.key))

    // Release slots no longer wanted.
    for (const [key, visual] of this.promoted) {
      if (!chosenKeys.has(key)) {
        visual.group.visible = false
        this.promoted.delete(key)
        this.promotionPool.push(visual)
      }
    }

    // Assign new ones.
    for (const { body } of chosen) {
      if (this.promoted.has(body.key)) continue
      const visual = this.promotionPool.pop()
      if (!visual) break
      visual.body = body
      visual.group.visible = true
      // Flat colour now; the surface arrives on a later frame, so approaching a
      // new rock never costs a dropped frame.
      visual.material.uniforms.uMap!.value = solidTexture(body.color)
      visual.material.needsUpdate = true

      // Published shape, if this body has one — Phobos does. Cleared first:
      // these slots are recycled, and a slot that has just finished being
      // Phobos would otherwise hand its terrain to the next rock that lands in
      // it, which would look entirely convincing.
      visual.relief = null
      visual.reliefExaggeration = RELIEF_EXAGGERATION[body.key] ?? 1
      visual.material.uniforms.uHasRelief!.value = 0
      const relief = reliefFor(body.key)
      if (relief) {
        const target = visual
        void this.library.loadRelief(relief.file).then((tex) => {
          if (!tex || target.body !== body) return
          const u = target.material.uniforms
          u.uRelief!.value = tex
          u.uReliefMinKm!.value = relief.minKm
          u.uReliefSpanKm!.value = relief.maxKm - relief.minKm
          u.uHasRelief!.value = 1
          target.relief = relief
          target.material.needsUpdate = true
        })
      }

      const file = body.textureFile
      if (file && this.library.available(file)) {
        // Real imagery exists for this one (Vesta, and any other minor planet we
        // later find a map for) — always prefer it over a synthesised surface.
        visual.pendingProcedural = false
        const target = visual
        void this.library.load(file).then((tex) => {
          // The slot may have been reassigned while the texture decoded.
          if (tex && target.body === body) {
            target.material.uniforms.uMap!.value = tex
            target.material.needsUpdate = true
          }
        })
      } else {
        visual.pendingProcedural = true
      }
      this.promoted.set(body.key, visual)
    }

    for (const visual of this.promoted.values()) {
      this.updateVisual(visual, scale, sunSceneRadius)
    }
  }

  private updateMinorPoints(): void {
    const points = this.minorPoints
    if (!points) return
    points.visible = this.toggles.minorBodies
    if (!points.visible) return

    const camera = this.currentCamera
    for (let i = 0; i < this.minorBodies.length; i++) {
      const body = this.minorBodies[i]!
      // Absolute scene coordinates; the world group applies the origin shift.
      this.minorPositions[i * 3] = body.scene.x
      this.minorPositions[i * 3 + 1] = body.scene.y
      this.minorPositions[i * 3 + 2] = body.scene.z
      // Hide the point when the body has been promoted to a real sphere.
      this.minorSizes[i] = this.promoted.has(body.key) ? 0 : 1
    }
    void camera
    const posAttr = points.geometry.getAttribute('position') as BufferAttribute
    const sizeAttr = points.geometry.getAttribute('aSize') as BufferAttribute
    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true

    const material = points.material as ShaderMaterial
    material.uniforms.uPixelRatio!.value = this.renderer.getPixelRatio()
  }

  private updateSwarms(system: SolarSystem, scale: ScaleModel): void {
    const material = this.swarmMaterial
    if (!material || !this.swarmPoints) return
    this.swarmPoints.visible = this.toggles.belts
    if (!this.swarmPoints.visible) return

    material.uniforms.uDays!.value = system.jdTT - 2451545.0
    material.uniforms.uBlend!.value = scale.blendAmount
    material.uniforms.uHelioExp!.value = scale.params.heliocentricExponent
    material.uniforms.uSceneUnitKm!.value = SCENE_UNIT_KM
    material.uniforms.uPixelRatio!.value = this.renderer.getPixelRatio()
    // Dust, not paint: the belts should read as a haze you can see structure
    // through, not a solid torus that hides the planets behind it.
    material.uniforms.uOpacity!.value = 0.5
  }

  private updateOrbits(system: SolarSystem, scale: ScaleModel, dt: number): void {
    this.orbitGroup.visible = this.toggles.orbits !== 'none'
    if (!this.orbitGroup.visible) return

    // Follow the parents every frame. Vertices are stored parent-relative, so
    // each line has to be re-seated on its parent as that parent moves —
    // rebuilding on the timer alone would let a moon's orbit lag behind its
    // planet by up to a quarter second of orbital motion.
    for (const [key, entry] of this.orbitLines) {
      const parent = system.byKey.get(key)?.parent
      if (parent) entry.line.position.set(parent.scene.x, parent.scene.y, parent.scene.z)
    }

    // Shape only changes as the scale blends or the elements precess, so
    // resampling a few times a second is plenty.
    this.orbitRebuildTimer -= dt
    const force = scale.isTransitioning
    if (this.orbitRebuildTimer > 0 && !force) return
    this.orbitRebuildTimer = 0.25

    const wanted = new Set<string>()
    const consider = (body: SimBody, opacity: number): void => {
      if (!body.elements && body.key !== 'moon:Moon') return
      wanted.add(body.key)
      this.ensureOrbit(body, system, scale, opacity)
    }

    for (const body of system.sun.children) {
      if (body.type === 'planet' || body.type === 'dwarf') consider(body, 0.3)
    }
    if (this.toggles.orbits === 'all') {
      for (const body of system.bodies) {
        if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) consider(body, 0.22)
        if (body.type === 'asteroid') consider(body, 0.14)
      }
    } else {
      // Even in "planets" mode, show the moons of whatever you are looking at —
      // but only the major ones. Drawing all 291 of Saturn's (or all 214 minor
      // planets, when the Sun is focused) turns the screen into a ball of wool.
      const host = this.currentFocus?.type === 'moon' ? this.currentFocus.parent : this.currentFocus
      if (host && host !== system.sun) {
        const majors = host.children
          .filter((c) => c.type === 'moon' && c.radiusKm >= MAJOR_MOON_RADIUS)
          .sort((a, b) => b.radiusKm - a.radiusKm)
          .slice(0, 12)
        for (const moon of majors) consider(moon, 0.28)
      }
    }
    if (this.selected) consider(this.selected, 0.55)

    for (const [key, entry] of this.orbitLines) {
      if (!wanted.has(key)) {
        this.orbitGroup.remove(entry.line)
        entry.line.geometry.dispose()
        entry.material.dispose()
        this.orbitLines.delete(key)
      }
    }
  }

  private ensureOrbit(
    body: SimBody,
    system: SolarSystem,
    scale: ScaleModel,
    opacity: number,
  ): void {
    const segments = body.type === 'asteroid' ? 192 : 512
    const points = system.orbitPolyline(body, scale, segments)
    if (!points) return

    let entry = this.orbitLines.get(body.key)
    if (!entry) {
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(points, 3))
      const indices = new Float32Array(segments + 1)
      for (let i = 0; i <= segments; i++) indices[i] = i
      geo.setAttribute('aIndex', new BufferAttribute(indices, 1))
      const material = createOrbitMaterial(body.color, opacity)
      material.uniforms.uCount!.value = segments
      const line = new Line(geo, material)
      line.frustumCulled = false
      line.renderOrder = 1
      this.orbitGroup.add(line)
      entry = { line, material }
      this.orbitLines.set(body.key, entry)
      // Seat it on the parent immediately; the per-frame loop above keeps it
      // there. Three composes this translation on the CPU in float64, so the
      // large offset never touches the float32 vertex buffer.
      const parent = body.parent
      if (parent) line.position.set(parent.scene.x, parent.scene.y, parent.scene.z)
    } else {
      const attr = entry.line.geometry.getAttribute('position') as BufferAttribute
      if (attr.array.length === points.length) {
        ;(attr.array as Float32Array).set(points)
        attr.needsUpdate = true
      } else {
        entry.line.geometry.setAttribute('position', new BufferAttribute(points, 3))
      }
    }
    entry.material.uniforms.uOpacity!.value = body === this.selected ? 0.7 : opacity
  }

  private updateSky(): void {
    const camera = this.currentCamera
    if (!this.sky || !camera) return
    this.sky.visible = this.toggles.milkyway
    // Keep the backdrop centred on the camera and large enough to sit behind
    // everything; depth testing is off so the radius is cosmetic.
    this.sky.position.copy(camera.position)
    this.sky.scale.setScalar(1e8)
  }

  // -- labels ---------------------------------------------------------------

  private updateLabels(system: SolarSystem): void {
    const host = this.labelHost
    const camera = this.currentCamera
    if (!host || !camera) return

    if (this.toggles.labels === 'none') {
      for (const el of this.labelPool) el.style.display = 'none'
      return
    }

    const candidates: SimBody[] = []
    for (const body of system.bodies) {
      if (body.type === 'star' || body.type === 'planet' || body.type === 'dwarf') {
        candidates.push(body)
      } else if (this.toggles.labels === 'all') {
        candidates.push(body)
      } else if (body === this.selected || body === this.currentFocus) {
        candidates.push(body)
      } else if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) {
        // Only label moons of the system you are actually in, or the clutter is
        // unreadable.
        const host2 = this.currentFocus?.type === 'moon' ? this.currentFocus.parent : this.currentFocus
        if (body.parent === host2) candidates.push(body)
      }
    }

    let used = 0
    const half = this.viewport.clone().multiplyScalar(0.5)
    for (const body of candidates) {
      if (used >= 120) break
      this.tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.origin)
      const distance = camera.position.distanceTo(this.tmpVec)
      // Skip if behind the camera or absurdly far relative to the view.
      this.tmpVec2.copy(this.tmpVec).project(camera)
      if (this.tmpVec2.z > 1 || this.tmpVec2.z < -1) continue
      const x = (this.tmpVec2.x * 0.5 + 0.5) * this.viewport.x
      const y = (-this.tmpVec2.y * 0.5 + 0.5) * this.viewport.y
      if (x < -80 || y < -20 || x > this.viewport.x + 80 || y > this.viewport.y + 20) continue

      // Hide the label when the body fills the screen: you know where it is.
      const apparent = (body.sceneRadius / Math.max(distance, 1e-9)) * this.viewport.y
      if (apparent > this.viewport.y * 0.75) continue

      const el = this.labelElement(used++)
      el.style.display = 'block'
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${(y - Math.min(apparent, 40) - 12).toFixed(1)}px)`
      const isSelected = body === this.selected
      el.textContent = body.name
      el.className = `label label--${body.type}${isSelected ? ' label--selected' : ''}`
      el.style.opacity = String(isSelected ? 1 : body.type === 'moon' || body.type === 'asteroid' ? 0.62 : 0.9)
      void half
    }
    for (let i = used; i < this.labelPool.length; i++) this.labelPool[i]!.style.display = 'none'
  }

  private labelElement(index: number): HTMLElement {
    let el = this.labelPool[index]
    if (!el) {
      el = document.createElement('div')
      el.className = 'label'
      this.labelHost!.appendChild(el)
      this.labelPool[index] = el
    }
    return el
  }

  // -- interaction ----------------------------------------------------------

  /**
   * Nearest body to a screen position, within a pixel tolerance.
   *
   * Screen-space proximity rather than ray casting, so point-rendered minor
   * bodies are just as clickable as full spheres.
   */
  pick(clientX: number, clientY: number, system: SolarSystem, tolerance = 22): SimBody | null {
    const camera = this.currentCamera
    if (!camera) return null

    let best: SimBody | null = null
    let bestScore = Infinity

    for (const body of system.bodies) {
      this.tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.origin)
      this.tmpVec2.copy(this.tmpVec).project(camera)
      if (this.tmpVec2.z < -1 || this.tmpVec2.z > 1) continue
      const x = (this.tmpVec2.x * 0.5 + 0.5) * this.viewport.x
      const y = (-this.tmpVec2.y * 0.5 + 0.5) * this.viewport.y
      const dx = x - clientX
      const dy = y - clientY
      const pixelDistance = Math.hypot(dx, dy)

      const distance = camera.position.distanceTo(this.tmpVec)
      const apparent = (body.sceneRadius / Math.max(distance, 1e-9)) * this.viewport.y
      // Clicking anywhere on a large body should select it.
      const reach = Math.max(tolerance, apparent)
      if (pixelDistance > reach) continue

      // Prefer whatever is closest to the cursor, breaking ties toward the
      // nearer body so a moon in front of its planet wins.
      const score = pixelDistance - Math.min(apparent, 40) * 0.5 + Math.log10(distance + 10) * 0.5
      if (score < bestScore) {
        bestScore = score
        best = body
      }
    }
    return best
  }

  setSelected(body: SimBody | null): void {
    this.selected = body
  }

  // -- resize / render ------------------------------------------------------

  resize(width: number, height: number, camera: PerspectiveCamera): void {
    this.viewport.set(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].maxPixelRatio))
    this.renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    const size = this.renderer.getDrawingBufferSize(new Vector2())
    this.composer?.setSize(size.x, size.y)
    this.bloom?.setSize(size.x, size.y)
    const material = this.minorPoints?.material as ShaderMaterial | undefined
    material?.uniforms.uViewport?.value.set(width, height)
    this.swarmMaterial?.uniforms.uViewport?.value.set(width, height)
  }

  render(camera: PerspectiveCamera): void {
    this.currentCamera = camera
    if (this.renderPass) this.renderPass.camera = camera
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, camera)
  }

  dispose(): void {
    this.composer?.dispose()
    this.renderer.dispose()
    for (const geo of this.lodGeometries) geo.dispose()
  }
}

// ---------------------------------------------------------------------------
// Minor-body points material
// ---------------------------------------------------------------------------

/**
 * Points shader for the individually simulated minor bodies. Unlike the swarm
 * shader these already have CPU-computed positions; the shader only handles
 * apparent size and fade.
 */
function createMinorPointsMaterial(sprite: Texture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uSprite: { value: sprite },
      uPixelRatio: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
      uOpacity: { value: 0.95 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vFade;
      // <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vColor = aColor;
        vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 1e-4);
        // aSize is 0 when the body has been promoted to a real mesh.
        gl_PointSize = aSize * clamp(uPixelRatio * 420.0 / dist, 1.2, 7.0);
        vFade = aSize * clamp(gl_PointSize / 2.0, 0.25, 1.0);
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
        if (vFade <= 0.001) discard;
        float a = texture2D(uSprite, gl_PointCoord).a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a * vFade * uOpacity);
      }
    `,
  })
}
