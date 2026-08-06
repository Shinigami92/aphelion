/**
 * Procedural surface textures.
 *
 * We have real imagery for the Sun, the planets, the Moon, the Galileans,
 * Enceladus and four dwarf planets. That leaves ~450 satellites and minor
 * planets with no map ever made of them — most are unresolved points of light
 * even to Hubble. Rather than paint them all flat grey, this module synthesises
 * a plausible surface from what *is* known: size, parent, albedo class and
 * whether the body is icy or rocky.
 *
 * The results are honest about being synthetic (the UI labels them as such) but
 * they carry real information: crater density scales with surface age, icy
 * bodies get brighter and bluer, tiny irregulars get lumpy albedo patchwork
 * instead of neat spheres.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'

export type SurfaceClass = 'rocky' | 'icy' | 'dark' | 'sulfurous' | 'metallic'

export interface ProceduralOptions {
  /** Base colour, 0xrrggbb. */
  color: number
  /** Body radius in km — drives resolution and crater scaling. */
  radiusKm: number
  surface: SurfaceClass
  /** Deterministic seed, usually derived from the body name. */
  seed: number
}

/** Stable string → 32-bit seed, so a body looks the same on every load. */
export function seedFromName(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Value noise on a lat/lon grid
// ---------------------------------------------------------------------------

/**
 * 3D value noise sampled on the sphere, so the texture wraps seamlessly in
 * longitude and does not pinch at the poles — the two failure modes of naive
 * 2D noise on a cylindrical map.
 */
class SphereNoise {
  private perm: Uint8Array

  constructor(rng: () => number) {
    const p = new Uint8Array(512)
    const base = new Uint8Array(256)
    for (let i = 0; i < 256; i++) base[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = base[i]!
      base[i] = base[j]!
      base[j] = t
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255]!
    this.perm = p
  }

  private hash(x: number, y: number, z: number): number {
    const p = this.perm
    return p[(p[(p[x & 255]! + y) & 255]! + z) & 255]! / 255
  }

  /** Trilinear value noise. */
  noise(x: number, y: number, z: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = x - xi
    const yf = y - yi
    const zf = z - zi
    // Smoothstep fade.
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const w = zf * zf * (3 - 2 * zf)

    const c000 = this.hash(xi, yi, zi)
    const c100 = this.hash(xi + 1, yi, zi)
    const c010 = this.hash(xi, yi + 1, zi)
    const c110 = this.hash(xi + 1, yi + 1, zi)
    const c001 = this.hash(xi, yi, zi + 1)
    const c101 = this.hash(xi + 1, yi, zi + 1)
    const c011 = this.hash(xi, yi + 1, zi + 1)
    const c111 = this.hash(xi + 1, yi + 1, zi + 1)

    const x00 = c000 + (c100 - c000) * u
    const x10 = c010 + (c110 - c010) * u
    const x01 = c001 + (c101 - c001) * u
    const x11 = c011 + (c111 - c011) * u
    const y0 = x00 + (x10 - x00) * v
    const y1 = x01 + (x11 - x01) * v
    return y0 + (y1 - y0) * w
  }

  /** Fractal sum. */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2.07, gain = 0.5): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f, y * f, z * f)
      norm += amp
      amp *= gain
      f *= lacunarity
    }
    return sum / norm
  }
}

// ---------------------------------------------------------------------------
// Surface class tuning
// ---------------------------------------------------------------------------

interface SurfaceProfile {
  /** Crater areal density multiplier. */
  cratering: number
  /** Albedo contrast of the mottling. */
  contrast: number
  /** Brightness of crater ejecta rays relative to the surface. */
  ejecta: number
  /** Polar frost brightening, 0-1. */
  polarFrost: number
  /** Extra tint applied multiplicatively. */
  tint: [number, number, number]
}

const PROFILES: Record<SurfaceClass, SurfaceProfile> = {
  rocky: { cratering: 1.0, contrast: 0.3, ejecta: 0.35, polarFrost: 0.0, tint: [1, 0.97, 0.93] },
  icy: { cratering: 0.75, contrast: 0.22, ejecta: 0.55, polarFrost: 0.35, tint: [0.95, 0.98, 1.02] },
  dark: { cratering: 1.15, contrast: 0.42, ejecta: 0.15, polarFrost: 0.0, tint: [0.85, 0.83, 0.8] },
  sulfurous: { cratering: 0.1, contrast: 0.5, ejecta: 0.1, polarFrost: 0.0, tint: [1.1, 0.95, 0.55] },
  metallic: { cratering: 0.9, contrast: 0.35, ejecta: 0.3, polarFrost: 0.0, tint: [1.0, 0.95, 0.88] },
}

/** Pick a surface class from what we know about a body. */
export function classifySurface(opts: {
  parentKey?: string | null
  name?: string
  radiusKm: number
  isMoon: boolean
}): SurfaceClass {
  const { parentKey, radiusKm, isMoon } = opts
  if (!isMoon) return radiusKm > 300 ? 'rocky' : 'dark'
  // Satellites of the ice giants and the outer Saturnian system are ice-rich;
  // the captured irregulars are carbonaceous and very dark.
  if (parentKey === 'saturn' || parentKey === 'uranus' || parentKey === 'neptune') {
    return radiusKm > 60 ? 'icy' : 'dark'
  }
  if (parentKey === 'jupiter') return radiusKm > 80 ? 'rocky' : 'dark'
  if (parentKey === 'pluto') return 'icy'
  return radiusKm > 40 ? 'rocky' : 'dark'
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Texture width chosen from body size; small rocks need very little. */
function resolutionFor(radiusKm: number): number {
  if (radiusKm >= 500) return 1024
  if (radiusKm >= 120) return 768
  if (radiusKm >= 30) return 512
  return 256
}

interface Crater {
  /** Unit vector of the crater centre. */
  x: number
  y: number
  z: number
  /** Angular radius, radians. */
  radius: number
  depth: number
  bright: number
}

function generateCraters(rng: () => number, count: number, maxAngular: number): Crater[] {
  const craters: Crater[] = []
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere.
    const u = rng() * 2 - 1
    const phi = rng() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    // Power-law size distribution: many small, few large.
    const t = Math.pow(rng(), 2.4)
    craters.push({
      x: s * Math.cos(phi),
      y: s * Math.sin(phi),
      z: u,
      radius: maxAngular * (0.06 + 0.94 * t),
      depth: 0.35 + rng() * 0.5,
      bright: 0.6 + rng() * 0.8,
    })
  }
  // Largest first so small craters overprint big ones, as in reality.
  craters.sort((a, b) => b.radius - a.radius)
  return craters
}

const cache = new Map<string, Texture>()

/**
 * Build (and memoise) a procedural albedo map for a body.
 *
 * Returns a CanvasTexture ready to drop into a material's `map` slot.
 */
export function proceduralSurface(cacheKey: string, opts: ProceduralOptions): Texture {
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const profile = PROFILES[opts.surface]
  const width = resolutionFor(opts.radiusKm)
  const height = width >> 1

  const rng = mulberry32(opts.seed)
  const noise = new SphereNoise(rng)

  // Crater count scales with surface area; big bodies also have big basins.
  const areaFactor = Math.max(0.35, Math.min(3.2, Math.log10(Math.max(2, opts.radiusKm)) / 1.6))
  const craterCount = Math.round(90 * profile.cratering * areaFactor * (width / 512))
  const maxAngular = opts.radiusKm > 200 ? 0.28 : 0.55
  const craters = generateCraters(rng, craterCount, maxAngular)

  // Irregular small bodies get strong low-frequency albedo variation, which is
  // what actually makes an unresolved rock look like a rock.
  const lumpiness = opts.radiusKm < 60 ? 1.0 : opts.radiusKm < 200 ? 0.6 : 0.35

  const baseR = ((opts.color >> 16) & 255) / 255
  const baseG = ((opts.color >> 8) & 255) / 255
  const baseB = (opts.color & 255) / 255

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('2D canvas unavailable for procedural texture generation')

  const img = ctx.createImageData(width, height)
  const px = img.data

  // Pre-scale noise frequency so features are a similar *physical* size
  // regardless of body radius.
  const freq = 2.2 + Math.min(6, Math.log10(Math.max(2, opts.radiusKm)) * 1.9)

  // Pass 1: base albedo mottling.
  const shade = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    // Latitude from -pi/2 to +pi/2.
    const lat = (0.5 - (j + 0.5) / height) * Math.PI
    const cosLat = Math.cos(lat)
    const sinLat = Math.sin(lat)

    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2
      const nx = cosLat * Math.cos(lon)
      const ny = cosLat * Math.sin(lon)

      const macro = noise.fbm(nx * 1.3 + 11, ny * 1.3 + 5, sinLat * 1.3 + 23, 3)
      const detail = noise.fbm(nx * freq, ny * freq, sinLat * freq, 5)
      shade[j * width + i] =
        1 + (detail - 0.5) * profile.contrast + (macro - 0.5) * lumpiness * 0.55
    }
  }

  // Pass 2: stamp the craters — a darkened floor, a bright rim and a fading
  // ejecta blanket.
  //
  // Each crater touches only the pixels inside its own latitude/longitude
  // extent. Testing every crater against every pixel is O(pixels x craters) and
  // was by far the most expensive thing in the app; bounding them makes it
  // O(total crater area), which is a 5-10x saving at these sizes.
  for (const cr of craters) {
    const reach = cr.radius * 2.1
    const latC = Math.asin(Math.max(-1, Math.min(1, cr.z)))
    let lonC = Math.atan2(cr.y, cr.x)
    if (lonC < 0) lonC += Math.PI * 2

    const jOf = (lat: number): number => (0.5 - lat / Math.PI) * height - 0.5
    const jStart = Math.max(0, Math.floor(jOf(Math.min(Math.PI / 2, latC + reach))))
    const jEnd = Math.min(height - 1, Math.ceil(jOf(Math.max(-Math.PI / 2, latC - reach))))

    for (let j = jStart; j <= jEnd; j++) {
      const lat = (0.5 - (j + 0.5) / height) * Math.PI
      const cosLat = Math.cos(lat)
      const sinLat = Math.sin(lat)

      // Longitude half-width of the cap at this latitude. Close to the poles a
      // small cap spans every longitude, so fall back to the whole row.
      let halfSpan: number
      if (cosLat < 1e-4 || reach >= Math.PI / 2) {
        halfSpan = Math.PI
      } else {
        const ratio = Math.sin(reach) / cosLat
        halfSpan = ratio >= 1 ? Math.PI : Math.asin(ratio) * 1.15
      }
      const iSpan = Math.min(width / 2, (halfSpan / (Math.PI * 2)) * width + 1)
      const iCentre = (lonC / (Math.PI * 2)) * width - 0.5

      for (let ii = Math.floor(iCentre - iSpan); ii <= Math.ceil(iCentre + iSpan); ii++) {
        const i = ((ii % width) + width) % width
        const lon = ((i + 0.5) / width) * Math.PI * 2
        const dotp =
          cosLat * Math.cos(lon) * cr.x + cosLat * Math.sin(lon) * cr.y + sinLat * cr.z
        if (dotp <= 0) continue // far hemisphere
        const ang = Math.acos(Math.min(1, dotp))
        if (ang > reach) continue

        const t = ang / cr.radius
        const idx = j * width + i
        if (t < 0.82) {
          // Floor: darkened, with a slight central peak for larger craters.
          const floor = 1 - cr.depth * 0.42 * (1 - t * 0.5)
          const peak = cr.radius > maxAngular * 0.45 && t < 0.16 ? 1.16 : 1
          shade[idx] = shade[idx]! * floor * peak
        } else if (t < 1.06) {
          shade[idx] = shade[idx]! * (1 + 0.3 * cr.bright)
        } else {
          const f = 1 - (t - 1.06) / 1.04
          shade[idx] = shade[idx]! * (1 + profile.ejecta * cr.bright * f * f * 0.6)
        }
      }
    }
  }

  // Pass 3: polar frost on icy bodies, then clamp and write out.
  for (let j = 0; j < height; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI
    const frost =
      profile.polarFrost > 0
        ? 1 + profile.polarFrost * Math.pow(Math.abs(Math.sin(lat)), 3.2)
        : 1
    for (let i = 0; i < width; i++) {
      const idx = j * width + i
      const s = Math.max(0.12, Math.min(2.2, shade[idx]! * frost))
      const o = idx * 4
      px[o] = clamp255(baseR * profile.tint[0] * s * 255)
      px[o + 1] = clamp255(baseG * profile.tint[1] * s * 255)
      px[o + 2] = clamp255(baseB * profile.tint[2] * s * 255)
      px[o + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  // Row 0 of the generated image is the north pole, matching the sphere's v.
  texture.flipY = false
  texture.needsUpdate = true

  cache.set(cacheKey, texture)
  return texture
}

/**
 * A flat texture in the body's base colour.
 *
 * Used as the instant stand-in while real imagery downloads, or before a
 * procedural surface has been synthesised. Costs microseconds, so nothing on
 * screen is ever black and first paint never waits on generation.
 */
export function solidTexture(color: number): Texture {
  const key = `solid:${color}`
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`
  ctx.fillRect(0, 0, 4, 4)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.flipY = false
  tex.needsUpdate = true
  cache.set(key, tex)
  return tex
}

/**
 * A soft radial sprite, used for point-rendered minor planets, the belt swarms
 * and the sun's glare. Generated once and shared.
 */
let dotSprite: Texture | null = null

export function pointSprite(): Texture {
  if (dotSprite) return dotSprite
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.needsUpdate = true
  dotSprite = tex
  return tex
}

/**
 * Procedural ring texture: concentric bands with varying optical depth, used for
 * Jupiter, Uranus and Neptune (Saturn has a real photometric profile).
 *
 * Returns a 1 x N strip sampled radially, which is all a ring needs.
 */
export function proceduralRing(
  cacheKey: string,
  opts: { color: number; seed: number; gaps: number; sharpness: number },
): Texture {
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const width = 1024
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, 1)
  const px = img.data

  const rng = mulberry32(opts.seed)
  const r = ((opts.color >> 16) & 255) / 255
  const g = ((opts.color >> 8) & 255) / 255
  const b = (opts.color & 255) / 255

  // A handful of narrow, sharply bounded ringlets — the actual morphology of
  // the Uranian and Neptunian systems.
  const bands: { center: number; width: number; depth: number }[] = []
  for (let i = 0; i < opts.gaps; i++) {
    bands.push({
      center: rng(),
      width: 0.006 + rng() * 0.05,
      depth: 0.35 + rng() * 0.65,
    })
  }

  for (let i = 0; i < width; i++) {
    const t = i / (width - 1)
    let alpha = 0.06
    for (const band of bands) {
      const d = Math.abs(t - band.center) / band.width
      alpha += band.depth * Math.exp(-Math.pow(d, opts.sharpness))
    }
    // Slight radial brightness falloff.
    alpha *= 0.85 + 0.3 * (1 - t)
    alpha = Math.max(0, Math.min(1, alpha))

    const o = i * 4
    px[o] = clamp255(r * 255)
    px[o + 1] = clamp255(g * 255)
    px[o + 2] = clamp255(b * 255)
    px[o + 3] = clamp255(alpha * 255)
  }
  ctx.putImageData(img, 0, 0)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.needsUpdate = true
  cache.set(cacheKey, tex)
  return tex
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0)

/** Free every generated texture (used on teardown). */
export function disposeProcedural(): void {
  for (const tex of cache.values()) tex.dispose()
  cache.clear()
  dotSprite?.dispose()
  dotSprite = null
}
