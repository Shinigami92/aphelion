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

import type { SurfaceClass, SurfaceProfile } from './surface-class.ts';
import type { Texture } from 'three';
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { cache, clamp255 } from './cache.ts';
import { generateCraters, stampCraters } from './craters.ts';
import { mulberry32, SphereNoise } from './noise.ts';
import { PROFILES } from './surface-class.ts';

export interface ProceduralOptions {
  /** Base colour, 0xrrggbb. */
  color: number;
  /** Body radius in km — drives resolution and crater scaling. */
  radiusKm: number;
  surface: SurfaceClass;
  /** Deterministic seed, usually derived from the body name. */
  seed: number;
}

/** Texture width chosen from body size; small rocks need very little. */
function resolutionFor(radiusKm: number): number {
  if (radiusKm >= 500) {
    return 1024;
  }
  if (radiusKm >= 120) {
    return 768;
  }
  if (radiusKm >= 30) {
    return 512;
  }
  return 256;
}

/**
 * Build (and memoise) a procedural albedo map for a body.
 *
 * Returns a CanvasTexture ready to drop into a material's `map` slot.
 */
export function proceduralSurface(cacheKey: string, opts: ProceduralOptions): Texture {
  const hit = cache.get(cacheKey);
  if (hit) {
    return hit;
  }

  const profile = PROFILES[opts.surface];
  const width = resolutionFor(opts.radiusKm);
  const height = width >> 1;

  const rng = mulberry32(opts.seed);
  const noise = new SphereNoise(rng);

  // Crater count scales with surface area; big bodies also have big basins.
  const areaFactor = Math.max(0.35, Math.min(3.2, Math.log10(Math.max(2, opts.radiusKm)) / 1.6));
  const craterCount = Math.round(90 * profile.cratering * areaFactor * (width / 512));
  const maxAngular = opts.radiusKm > 200 ? 0.28 : 0.55;
  const craters = generateCraters(rng, craterCount, maxAngular);

  const { canvas, ctx } = createCanvas(width, height);
  const img = ctx.createImageData(width, height);
  const px = img.data;

  const shade = mottle(noise, width, height, opts.radiusKm, profile.contrast);
  stampCraters(shade, width, height, craters, maxAngular, profile.ejecta);
  writeAlbedo(px, shade, width, height, opts.color, profile);

  ctx.putImageData(img, 0, 0);
  const texture = albedoTexture(canvas);

  cache.set(cacheKey, texture);
  return texture;
}

function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('2D canvas unavailable for procedural texture generation');
  }
  return { canvas, ctx };
}

/** Pass 1: base albedo mottling. */
function mottle(
  noise: SphereNoise,
  width: number,
  height: number,
  radiusKm: number,
  contrast: number,
): Float32Array {
  // Irregular small bodies get strong low-frequency albedo variation, which is
  // what actually makes an unresolved rock look like a rock.
  const lumpiness = radiusKm < 60 ? 1.0 : radiusKm < 200 ? 0.6 : 0.35;

  // Pre-scale noise frequency so features are a similar *physical* size
  // regardless of body radius.
  const freq = 2.2 + Math.min(6, Math.log10(Math.max(2, radiusKm)) * 1.9);

  const shade = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    // Latitude from -pi/2 to +pi/2.
    const lat = (0.5 - (j + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2;
      const nx = cosLat * Math.cos(lon);
      const ny = cosLat * Math.sin(lon);

      const macro = noise.fbm(nx * 1.3 + 11, ny * 1.3 + 5, sinLat * 1.3 + 23, 3);
      const detail = noise.fbm(nx * freq, ny * freq, sinLat * freq, 5);
      shade[j * width + i] = 1 + (detail - 0.5) * contrast + (macro - 0.5) * lumpiness * 0.55;
    }
  }
  return shade;
}

/** Pass 3: polar frost on icy bodies, then clamp and write out. */
function writeAlbedo(
  px: Uint8ClampedArray,
  shade: Float32Array,
  width: number,
  height: number,
  color: number,
  profile: SurfaceProfile,
): void {
  const baseR = ((color >> 16) & 255) / 255;
  const baseG = ((color >> 8) & 255) / 255;
  const baseB = (color & 255) / 255;
  for (let j = 0; j < height; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI;
    const frost =
      profile.polarFrost > 0 ? 1 + profile.polarFrost * Math.pow(Math.abs(Math.sin(lat)), 3.2) : 1;
    for (let i = 0; i < width; i++) {
      const idx = j * width + i;
      const s = Math.max(0.12, Math.min(2.2, shade[idx] * frost));
      const o = idx * 4;
      px[o] = clamp255(baseR * profile.tint[0] * s * 255);
      px[o + 1] = clamp255(baseG * profile.tint[1] * s * 255);
      px[o + 2] = clamp255(baseB * profile.tint[2] * s * 255);
      px[o + 3] = 255;
    }
  }
}

function albedoTexture(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  // Row 0 of the generated image is the north pole, matching the sphere's v.
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}
