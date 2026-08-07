/**
 * Texture loading.
 *
 * Real imagery lives in public/textures and is listed in the generated
 * manifest. Anything not on disk falls back to `procedural.ts`, so the app is
 * fully functional before `pnpm assets` has ever been run — it just looks
 * synthetic rather than photographic.
 *
 * Loads are lazy and prioritised: a body shows its procedural stand-in
 * immediately and swaps in the real map when it arrives, so first paint never
 * waits on a 14 MB Mercury.
 */

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  TextureLoader,
  type Texture,
} from 'three'
import { hasTexture } from '../data/generated/textures.ts'

const BASE = 'textures/'
const RELIEF_BASE = 'shapes/'

export type LoadListener = (loaded: number, total: number) => void

export class TextureLibrary {
  private loader = new TextureLoader()
  private cache = new Map<string, Texture>()
  private pending = new Map<string, Promise<Texture | null>>()
  private anisotropy = 8

  private requested = 0
  private completed = 0
  private listeners = new Set<LoadListener>()

  setAnisotropy(value: number): void {
    this.anisotropy = Math.max(1, value)
  }

  /** Is real imagery available for this filename? */
  available(file: string | null | undefined): boolean {
    return !!file && hasTexture(file)
  }

  /** Already-decoded texture, if we have it. */
  peek(file: string): Texture | null {
    return this.cache.get(file) ?? null
  }

  /**
   * Load a texture. Resolves to null when the file is not in the manifest or
   * the decode fails, letting callers keep their procedural fallback.
   */
  load(file: string): Promise<Texture | null> {
    const cached = this.cache.get(file)
    if (cached) return Promise.resolve(cached)

    const inFlight = this.pending.get(file)
    if (inFlight) return inFlight

    if (!this.available(file)) return Promise.resolve(null)

    this.requested++
    this.emit()

    const promise = new Promise<Texture | null>((resolve) => {
      this.loader.load(
        BASE + file,
        (tex) => {
          tex.wrapS = RepeatWrapping
          tex.minFilter = LinearMipmapLinearFilter
          tex.anisotropy = this.anisotropy
          tex.generateMipmaps = true
          // Our sphere's v runs from the north pole down, matching the row order
          // of an equirectangular map, so Three's default vertical flip would
          // put the Arctic in the south.
          tex.flipY = false
          tex.needsUpdate = true
          this.cache.set(file, tex)
          this.completed++
          this.emit()
          resolve(tex)
        },
        undefined,
        () => {
          // A missing or corrupt file is not fatal: the caller keeps its
          // procedural texture and the app carries on.
          console.warn(`[aphelion] could not load texture ${file}; using procedural fallback`)
          this.completed++
          this.emit()
          resolve(null)
        },
      )
    })

    this.pending.set(file, promise)
    return promise
  }

  /**
   * Load an elevation map from public/shapes.
   *
   * These carry numbers, not colour: height is a 16-bit value split across the
   * red and green channels, so every setting that would ordinarily improve an
   * image has to be off. Mipmaps and anisotropy would average the high and low
   * bytes independently and produce elevations that exist nowhere on the body,
   * and an sRGB decode would regrade the bytes outright. Sampling happens in the
   * vertex stage at one fixed level, so nothing is lost by refusing them.
   */
  loadRelief(file: string): Promise<Texture | null> {
    const cached = this.cache.get(RELIEF_BASE + file)
    if (cached) return Promise.resolve(cached)

    const inFlight = this.pending.get(RELIEF_BASE + file)
    if (inFlight) return inFlight

    this.requested++
    this.emit()

    const promise = new Promise<Texture | null>((resolve) => {
      this.loader.load(
        RELIEF_BASE + file,
        (tex) => {
          tex.wrapS = RepeatWrapping
          tex.minFilter = LinearFilter
          tex.magFilter = LinearFilter
          tex.generateMipmaps = false
          tex.anisotropy = 1
          tex.colorSpace = NoColorSpace
          // Same reason as the colour maps: our v runs from the north pole down.
          tex.flipY = false
          tex.needsUpdate = true
          this.cache.set(RELIEF_BASE + file, tex)
          this.completed++
          this.emit()
          resolve(tex)
        },
        undefined,
        () => {
          console.warn(`[aphelion] could not load relief ${file}; body stays an ellipsoid`)
          this.completed++
          this.emit()
          resolve(null)
        },
      )
    })

    this.pending.set(RELIEF_BASE + file, promise)
    return promise
  }

  /** Fire-and-forget preload of several files. */
  preload(files: (string | null | undefined)[]): Promise<void> {
    const jobs = files.filter((f): f is string => this.available(f)).map((f) => this.load(f))
    return Promise.all(jobs).then(() => undefined)
  }

  get progress(): { loaded: number; total: number } {
    return { loaded: this.completed, total: this.requested }
  }

  get idle(): boolean {
    return this.completed >= this.requested
  }

  onProgress(fn: LoadListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.completed, this.requested)
  }

  dispose(): void {
    for (const tex of this.cache.values()) tex.dispose()
    this.cache.clear()
    this.pending.clear()
  }
}
