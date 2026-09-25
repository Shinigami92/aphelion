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

import type { SurfaceClass } from './surface-class.ts';
import type { Texture } from 'three';
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { cache, clamp255 } from './cache.ts';
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

interface Crater {
  /** Unit vector of the crater centre. */
  x: number;
  y: number;
  z: number;
  /** Angular radius, radians. */
  radius: number;
  depth: number;
  bright: number;
}

function generateCraters(rng: () => number, count: number, maxAngular: number): Crater[] {
  const craters: Crater[] = [];
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere.
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    // Power-law size distribution: many small, few large.
    const t = Math.pow(rng(), 2.4);
    craters.push({
      x: s * Math.cos(phi),
      y: s * Math.sin(phi),
      z: u,
      radius: maxAngular * (0.06 + 0.94 * t),
      depth: 0.35 + rng() * 0.5,
      bright: 0.6 + rng() * 0.8,
    });
  }
  // Largest first so small craters overprint big ones, as in reality.
  craters.sort((a, b) => b.radius - a.radius);
  return craters;
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

  // Irregular small bodies get strong low-frequency albedo variation, which is
  // what actually makes an unresolved rock look like a rock.
  const lumpiness = opts.radiusKm < 60 ? 1.0 : opts.radiusKm < 200 ? 0.6 : 0.35;

  const baseR = ((opts.color >> 16) & 255) / 255;
  const baseG = ((opts.color >> 8) & 255) / 255;
  const baseB = (opts.color & 255) / 255;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('2D canvas unavailable for procedural texture generation');
  }

  const img = ctx.createImageData(width, height);
  const px = img.data;

  // Pre-scale noise frequency so features are a similar *physical* size
  // regardless of body radius.
  const freq = 2.2 + Math.min(6, Math.log10(Math.max(2, opts.radiusKm)) * 1.9);

  // Pass 1: base albedo mottling.
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
      shade[j * width + i] =
        1 + (detail - 0.5) * profile.contrast + (macro - 0.5) * lumpiness * 0.55;
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
    const reach = cr.radius * 2.1;
    const latC = Math.asin(Math.max(-1, Math.min(1, cr.z)));
    let lonC = Math.atan2(cr.y, cr.x);
    if (lonC < 0) {
      lonC += Math.PI * 2;
    }

    const jOf = (lat: number): number => (0.5 - lat / Math.PI) * height - 0.5;
    const jStart = Math.max(0, Math.floor(jOf(Math.min(Math.PI / 2, latC + reach))));
    const jEnd = Math.min(height - 1, Math.ceil(jOf(Math.max(-Math.PI / 2, latC - reach))));

    for (let j = jStart; j <= jEnd; j++) {
      const lat = (0.5 - (j + 0.5) / height) * Math.PI;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);

      // Longitude half-width of the cap at this latitude. Close to the poles a
      // small cap spans every longitude, so fall back to the whole row.
      let halfSpan: number;
      if (cosLat < 1e-4 || reach >= Math.PI / 2) {
        halfSpan = Math.PI;
      } else {
        const ratio = Math.sin(reach) / cosLat;
        halfSpan = ratio >= 1 ? Math.PI : Math.asin(ratio) * 1.15;
      }
      const iSpan = Math.min(width / 2, (halfSpan / (Math.PI * 2)) * width + 1);
      const iCentre = (lonC / (Math.PI * 2)) * width - 0.5;

      for (let ii = Math.floor(iCentre - iSpan); ii <= Math.ceil(iCentre + iSpan); ii++) {
        const i = ((ii % width) + width) % width;
        const lon = ((i + 0.5) / width) * Math.PI * 2;
        const dotp = cosLat * Math.cos(lon) * cr.x + cosLat * Math.sin(lon) * cr.y + sinLat * cr.z;
        if (dotp <= 0) {
          continue; // far hemisphere
        }
        const ang = Math.acos(Math.min(1, dotp));
        if (ang > reach) {
          continue;
        }

        const t = ang / cr.radius;
        const idx = j * width + i;
        if (t < 0.82) {
          // Floor: darkened, with a slight central peak for larger craters.
          const floor = 1 - cr.depth * 0.42 * (1 - t * 0.5);
          const peak = cr.radius > maxAngular * 0.45 && t < 0.16 ? 1.16 : 1;
          shade[idx] = shade[idx] * floor * peak;
        } else if (t < 1.06) {
          shade[idx] = shade[idx] * (1 + 0.3 * cr.bright);
        } else {
          const f = 1 - (t - 1.06) / 1.04;
          shade[idx] = shade[idx] * (1 + profile.ejecta * cr.bright * f * f * 0.6);
        }
      }
    }
  }

  // Pass 3: polar frost on icy bodies, then clamp and write out.
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

  ctx.putImageData(img, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  // Row 0 of the generated image is the north pole, matching the sphere's v.
  texture.flipY = false;
  texture.needsUpdate = true;

  cache.set(cacheKey, texture);
  return texture;
}
