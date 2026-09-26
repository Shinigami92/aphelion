/** Ring textures: published radial structure where it exists, generated ringlets where not. */

import type { RingBand } from '../../data/body-spec.ts';
import type { Texture } from 'three';
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { cache, clamp255 } from './cache.ts';
import { mulberry32 } from './noise.ts';

/** A 1 x `width` canvas, its context and the pixel buffer to fill. */
function createStrip(width: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, 1);
  return { canvas, ctx, img };
}

/**
 * A handful of narrow, sharply bounded ringlets — the actual morphology of
 * the Uranian and Neptunian systems.
 */
function ringletBands(
  rng: () => number,
  count: number,
): Array<{ center: number; width: number; depth: number }> {
  const bands: Array<{ center: number; width: number; depth: number }> = [];
  for (let i = 0; i < count; i++) {
    bands.push({
      center: rng(),
      width: 0.006 + rng() * 0.05,
      depth: 0.35 + rng() * 0.65,
    });
  }
  return bands;
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
  const hit = cache.get(cacheKey);
  if (hit) {
    return hit;
  }

  const width = 1024;
  const { canvas, ctx, img } = createStrip(width);
  const px = img.data;

  const rng = mulberry32(opts.seed);
  const r = ((opts.color >> 16) & 255) / 255;
  const g = ((opts.color >> 8) & 255) / 255;
  const b = (opts.color & 255) / 255;

  const bands = ringletBands(rng, opts.gaps);

  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    let alpha = 0.06;
    for (const band of bands) {
      const d = Math.abs(t - band.center) / band.width;
      alpha += band.depth * Math.exp(-Math.pow(d, opts.sharpness));
    }
    // Slight radial brightness falloff.
    alpha *= 0.85 + 0.3 * (1 - t);
    alpha = Math.max(0, Math.min(1, alpha));

    const o = i * 4;
    px[o] = clamp255(r * 255);
    px[o + 1] = clamp255(g * 255);
    px[o + 2] = clamp255(b * 255);
    px[o + 3] = clamp255(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.needsUpdate = true;
  cache.set(cacheKey, tex);
  return tex;
}

/** Integrate the bands crossing texel `i` and write its colour and opacity. */
function writeProfileTexel(
  px: Uint8ClampedArray,
  i: number,
  opts: { bands: ReadonlyArray<RingBand>; innerKm: number },
  texelKm: number,
): void {
  const loKm = opts.innerKm + i * texelKm;
  const hiKm = loKm + texelKm;

  // Optical depth averaged over this texel, and colour weighted by how much
  // of the texel's opacity each band actually contributes.
  let tau = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (const band of opts.bands) {
    const overlap = Math.min(hiKm, band.outerKm) - Math.max(loKm, band.innerKm);
    if (overlap <= 0) {
      continue;
    }
    const fraction = overlap / texelKm;
    tau += band.tau * fraction;
    const w = band.tau * fraction;
    if (w > 0) {
      r += ((band.color >> 16) & 255) * w;
      g += ((band.color >> 8) & 255) * w;
      b += (band.color & 255) * w;
      weight += w;
    }
  }

  // A ring that is there must not quantise to nothing. Optical depths this
  // low — the E ring is 1e-5 — land far below one part in 255, so an 8-bit
  // alpha channel rounds them to zero and every later brightness control is
  // then multiplying zero. Floor anything with material in it to the
  // smallest value the channel can hold and let the explore boost lift it.
  const alpha = tau > 0 ? Math.max(1 - Math.exp(-tau), 1 / 255) : 0;
  const o = i * 4;
  if (weight > 0) {
    px[o] = clamp255(r / weight);
    px[o + 1] = clamp255(g / weight);
    px[o + 2] = clamp255(b / weight);
  }
  px[o + 3] = clamp255(alpha * 255);
}

/**
 * Ring profile generated from published radial structure.
 *
 * Opacity comes from the physics rather than from taste: a band of normal
 * optical depth `tau` transmits `exp(-tau)` of the light behind it, so it
 * covers `1 - exp(-tau)`. That one line is what separates the B ring from the
 * Cassini Division without either being tuned by hand, and what keeps the
 * Uranian rings as faint as they really are next to Saturn's.
 *
 * Each texel **integrates** the bands crossing it rather than sampling the
 * midpoint. Uranus forces this: its rings are 2 to 8 km wide across a 9,700 km
 * span, so at any sane resolution a ring is *narrower than a texel*. Point
 * sampling would drop most of them entirely and make the rest flicker with
 * resolution. Averaging optical depth over the texel's own width is both the
 * physically meaningful quantity and inherently anti-aliased.
 */
export function ringProfile(
  cacheKey: string,
  opts: { bands: ReadonlyArray<RingBand>; innerKm: number; outerKm: number },
): Texture {
  const hit = cache.get(cacheKey);
  if (hit) {
    return hit;
  }

  // Fine enough that Uranus's narrowest ring still lands inside a texel or two.
  const width = 4096;
  const { canvas, ctx, img } = createStrip(width);
  const px = img.data;

  const spanKm = opts.outerKm - opts.innerKm;
  const texelKm = spanKm / width;

  for (let i = 0; i < width; i++) {
    writeProfileTexel(px, i, opts, texelKm);
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  // Mipmaps stay on, and they are doing something specific here. These profiles
  // are mostly vacuum punctuated by very narrow features — Uranus's epsilon
  // ring is 59 km inside a 9,700 km strip — so at any real viewing distance a
  // ring is far narrower than a screen pixel. Without a mip chain the GPU point
  // samples and the ring flickers in and out as it happens to hit or miss a
  // pixel centre; with one it averages down to a faint but *stable* line at the
  // right radius. Averaging is the correct answer; the brightness lost to it is
  // restored explicitly, and only in explore scale, by the ring material's
  // visibility boost.
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cache.set(cacheKey, tex);
  return tex;
}
