/** Deterministic randomness and value noise on the sphere. */

/** Stable string → 32-bit seed, so a body looks the same on every load. */
export function seedFromName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- FNV-1a over UTF-16 units; changing it would reseed every body
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 3D value noise sampled on the sphere, so the texture wraps seamlessly in
 * longitude and does not pinch at the poles — the two failure modes of naive
 * 2D noise on a cylindrical map.
 */
export class SphereNoise {
  private perm: Uint8Array;

  constructor(rng: () => number) {
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      base[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = base[i];
      base[i] = base[j]!;
      base[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      p[i] = base[i & 255]!;
    }
    this.perm = p;
  }

  private hash(x: number, y: number, z: number): number {
    const p = this.perm;
    return p[(p[(p[x & 255] + y) & 255] + z) & 255] / 255;
  }

  /** Trilinear value noise. */
  noise(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    // Smoothstep fade.
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = zf * zf * (3 - 2 * zf);

    const c000 = this.hash(xi, yi, zi);
    const c100 = this.hash(xi + 1, yi, zi);
    const c010 = this.hash(xi, yi + 1, zi);
    const c110 = this.hash(xi + 1, yi + 1, zi);
    const c001 = this.hash(xi, yi, zi + 1);
    const c101 = this.hash(xi + 1, yi, zi + 1);
    const c011 = this.hash(xi, yi + 1, zi + 1);
    const c111 = this.hash(xi + 1, yi + 1, zi + 1);

    const x00 = c000 + (c100 - c000) * u;
    const x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u;
    const x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  /** Fractal sum. */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2.07, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f, y * f, z * f);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}
