/** Which kind of surface a body gets, and how each kind is tuned. */

export type SurfaceClass = 'rocky' | 'icy' | 'dark' | 'sulfurous' | 'metallic';

export interface SurfaceProfile {
  /** Crater areal density multiplier. */
  cratering: number;
  /** Albedo contrast of the mottling. */
  contrast: number;
  /** Brightness of crater ejecta rays relative to the surface. */
  ejecta: number;
  /** Polar frost brightening, 0-1. */
  polarFrost: number;
  /** Extra tint applied multiplicatively. */
  tint: [number, number, number];
}

export const PROFILES: Record<SurfaceClass, SurfaceProfile> = {
  rocky: { cratering: 1.0, contrast: 0.3, ejecta: 0.35, polarFrost: 0.0, tint: [1, 0.97, 0.93] },
  icy: {
    cratering: 0.75,
    contrast: 0.22,
    ejecta: 0.55,
    polarFrost: 0.35,
    tint: [0.95, 0.98, 1.02],
  },
  dark: { cratering: 1.15, contrast: 0.42, ejecta: 0.15, polarFrost: 0.0, tint: [0.85, 0.83, 0.8] },
  sulfurous: {
    cratering: 0.1,
    contrast: 0.5,
    ejecta: 0.1,
    polarFrost: 0.0,
    tint: [1.1, 0.95, 0.55],
  },
  metallic: {
    cratering: 0.9,
    contrast: 0.35,
    ejecta: 0.3,
    polarFrost: 0.0,
    tint: [1.0, 0.95, 0.88],
  },
};

/** Pick a surface class from what we know about a body. */
export function classifySurface(opts: {
  parentKey?: string | null;
  name?: string;
  radiusKm: number;
  isMoon: boolean;
}): SurfaceClass {
  const { parentKey, radiusKm, isMoon } = opts;
  if (!isMoon) {
    return radiusKm > 300 ? 'rocky' : 'dark';
  }
  // Satellites of the ice giants and the outer Saturnian system are ice-rich;
  // the captured irregulars are carbonaceous and very dark.
  if (parentKey === 'saturn' || parentKey === 'uranus' || parentKey === 'neptune') {
    return radiusKm > 60 ? 'icy' : 'dark';
  }
  if (parentKey === 'jupiter') {
    return radiusKm > 80 ? 'rocky' : 'dark';
  }
  if (parentKey === 'pluto') {
    return 'icy';
  }
  return radiusKm > 40 ? 'rocky' : 'dark';
}
