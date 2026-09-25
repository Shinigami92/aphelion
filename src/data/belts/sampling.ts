/** The random draws and the population shape every belt generator shares. */

/** Deterministic PRNG so the belt looks identical on every run. */
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

/** Rayleigh-distributed sample — the standard fit for orbital e and i. */
export function rayleigh(rng: () => number, sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(1 - rng() * 0.999999));
}

export function gaussian(rng: () => number, mean: number, sigma: number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gaussian-mean-motion constant: n = k / a^1.5, radians/day for a in AU. */
export const GAUSS_K = 0.01720209895;

export const meanMotion = (a: number): number => GAUSS_K / Math.pow(a, 1.5);

export interface Writer {
  push: (
    a: number,
    e: number,
    inc: number,
    node: number,
    argPeri: number,
    m0: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ) => void;
}

export interface PopulationSpec {
  name: string;
  count: number;
  color: [number, number, number];
  sizeScale: number;
  generate: (rng: () => number, w: Writer, color: [number, number, number]) => void;
}

export const TWO_PI = Math.PI * 2;

/** Slight per-particle colour jitter so the swarm never looks like flat paint. */
export function jitterColor(
  rng: () => number,
  base: [number, number, number],
  amount: number,
): [number, number, number] {
  const k = 1 + (rng() - 0.5) * amount;
  return [base[0] * k, base[1] * k, base[2] * k];
}
