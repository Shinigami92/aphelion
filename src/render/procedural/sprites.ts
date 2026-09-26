/** Small generated textures: flat placeholders and the point and marker sprites. */

import type { Texture } from 'three';
import { CanvasTexture, RepeatWrapping } from 'three';
import { cache } from './cache.ts';

/**
 * A flat texture in the body's base colour.
 *
 * Used as the instant stand-in while real imagery downloads, or before a
 * procedural surface has been synthesised. Costs microseconds, so nothing on
 * screen is ever black and first paint never waits on generation.
 */
export function solidTexture(color: number): Texture {
  const key = `solid:${color}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 4, 4);

  // Untagged for the same reason as the procedural albedo: the shaders decode
  // sRGB, and this texture is often swapped in without passing `prepare()`.
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * A soft radial sprite, used for point-rendered minor planets, the belt swarms
 * and the sun's glare. Generated once and shared.
 */
let dotSprite: Texture | null = null;

export function pointSprite(): Texture {
  if (dotSprite) {
    return dotSprite;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  dotSprite = tex;
  return tex;
}

/**
 * A hollow ring with a centre pip, for the Lagrange-point markers.
 *
 * Deliberately not a dot. Everything else drawn as a point in this scene is an
 * object — a minor planet, a belt particle, a star — and a Lagrange point is
 * not: it is a place. A reticle reads as an annotation at a glance, where one
 * more soft blob among 75,000 belt points would read as one more rock.
 */
let reticleSprite: Texture | null = null;

export function markerSprite(): Texture {
  if (reticleSprite) {
    return reticleSprite;
  }
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  ctx.strokeStyle = 'rgba(255,255,255,1)';
  // Thick enough to survive being drawn at 13 device pixels and mipmapped down.
  ctx.lineWidth = size * 0.075;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.31, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.075, 0, Math.PI * 2);
  ctx.fill();

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  reticleSprite = tex;
  return tex;
}

/** Free every generated texture (used on teardown). */
export function disposeProcedural(): void {
  for (const tex of cache.values()) {
    tex.dispose();
  }
  cache.clear();
  dotSprite?.dispose();
  dotSprite = null;
}
