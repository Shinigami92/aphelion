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
  Line,
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
  proceduralSurface,
  seedFromName,
  solidTexture,
} from './procedural.ts'
import {
  createAtmosphereMaterial,
  createBodyMaterial,
  createCloudMaterial,
  createCoronaMaterial,
  createOrbitMaterial,
  createRingMaterial,
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

/** Flat annulus in the xy plane, for ring systems. */
function createAnnulus(inner: number, outer: number, segments: number): BufferGeometry {
  const seg = Math.max(48, segments)
  const positions = new Float32Array((seg + 1) * 2 * 3)
  const indices: number[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const o = i * 6
    positions[o] = cos * inner
    positions[o + 1] = sin * inner
    positions[o + 2] = 0
    positions[o + 3] = cos * outer
    positions[o + 4] = sin * outer
    positions[o + 5] = 0
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
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
        const innerRatio = ring.innerKm / body.radiusKm
        const outerRatio = ring.outerKm / body.radiusKm
        let texture: Texture
        if (ring.texture && this.library.available(ring.texture)) {
          texture = proceduralRing(`ring-placeholder:${body.key}:${ring.name}`, {
            color: body.color,
            seed: seedFromName(ring.name),
            gaps: 6,
            sharpness: 2,
          })
        } else {
          texture = proceduralRing(`ring:${body.key}:${ring.name}`, {
            color: ring.opacity > 0.1 ? 0xbfae92 : 0x8f8878,
            seed: seedFromName(`${body.key}${ring.name}`),
            gaps: body.key === 'uranus' ? 9 : body.key === 'neptune' ? 5 : 3,
            sharpness: body.key === 'jupiter' ? 1.4 : 3.2,
          })
        }
        const material = createRingMaterial({
          texture,
          innerRadius: innerRatio,
          outerRadius: outerRatio,
          opacity: ring.opacity,
        })
        const mesh = new Mesh(createAnnulus(innerRatio, outerRatio, 256), material)
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
        // Promoted minor bodies are the ones with no published topography by
        // definition; if that ever changes, promotion has to load it per body.
        relief: null,
        reliefExaggeration: 1,
      })
    }
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

    if (visual.relief) {
      // Model space is the unit sphere, so one unit of displacement is one body
      // radius: dividing the elevation by the true radius keeps relief in
      // proportion, and it then rides whatever scaling the body itself gets.
      const u = visual.material.uniforms
      u.uReliefScale!.value =
        scale.reliefExaggeration(visual.reliefExaggeration) / body.radiusKm
      const seg = LOD_SEGMENTS[visual.lod] ?? LOD_SEGMENTS[0]!
      u.uReliefStep!.value.set(1 / seg[0], 1 / seg[1])
    }

    basisToMatrix(body.orientation, this.tmpMatrix)
    visual.mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)
    visual.mesh.scale.set(radius, radius, radius * squash)

    if (visual.clouds) {
      visual.clouds.quaternion.copy(visual.mesh.quaternion)
      visual.clouds.scale.set(radius * 1.004, radius * 1.004, radius * 1.004 * squash)
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
    for (const ring of visual.rings) {
      ring.mesh.visible = this.toggles.rings
      poleMatrix(body.orientation.z, this.tmpMatrix)
      ring.mesh.quaternion.setFromRotationMatrix(this.tmpMatrix)
      ring.mesh.scale.setScalar(radius)
      const u = ring.material.uniforms
      u.uSunPos!.value.copy(this.sunRender)
      u.uSunRadius!.value = sunSceneRadius
      u.uPlanetCentre!.value.copy(centre)
      u.uPlanetRadius!.value = radius
      u.uInner!.value = (ring.spec.innerKm / body.radiusKm) * radius
      u.uOuter!.value = (ring.spec.outerKm / body.radiusKm) * radius
      this.tmpVec2.set(body.orientation.z.x, body.orientation.z.y, body.orientation.z.z)
      u.uNormal!.value.copy(this.tmpVec2)
    }

    // Ring shadow cast onto the planet itself.
    const mainRing = visual.rings[0]
    if (mainRing && this.toggles.rings) {
      const u = visual.material.uniforms
      u.uRingEnabled!.value = 1
      u.uRingTex!.value = mainRing.material.uniforms.uTex!.value
      u.uRingInner!.value = (mainRing.spec.innerKm / body.radiusKm) * radius
      u.uRingOuter!.value = (mainRing.spec.outerKm / body.radiusKm) * radius
      u.uRingNormal!.value.set(body.orientation.z.x, body.orientation.z.y, body.orientation.z.z)
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
