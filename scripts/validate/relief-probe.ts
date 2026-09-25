/** Reading a shipped relief map back, for the relief checks. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { reliefFor } from '../../src/data/generated/relief.ts';
import { decodePng, SHAPES_DIR } from './assets.ts';
import { ok } from './harness.ts';

// The 180 degree texture bug lived for a whole build because a wrongly rotated
// planet still looks like a planet. An elevation grid has the same failure mode
// and a much better test: it has named extremes at published coordinates, so a
// roll, a flip or a mirrored longitude shows up immediately.

export interface ReliefProbe {
  width: number;
  height: number;
  /** Elevation in km at a latitude and *east* longitude. */
  at(latDeg: number, lonEast: number): number;
  /** Cosine-weighted mean elevation over every sample the filter accepts. */
  mean(accept: (lat: number, lonEast: number) => boolean): number;
  /** Where the global extremes fall, as [lat, lonEast]. */
  extremes(): { hiAt: [number, number]; loAt: [number, number] };
}

export function probeRelief(key: string): ReliefProbe | null {
  const relief = reliefFor(key);
  if (!relief) {
    return null;
  }
  const file = path.join(SHAPES_DIR, relief.file);
  // Assets are checked in, so a missing file should not happen — but validate
  // must not fail on a tree where they have been cleared deliberately.
  if (!existsSync(file)) {
    return null;
  }

  const img = decodePng(readFileSync(file));
  ok(
    `${key} relief map matches its declared grid`,
    img.width === relief.width && img.height === relief.height,
    `${img.width}x${img.height} vs ${relief.width}x${relief.height}`,
  );

  const kmAt = (x: number, y: number): number => {
    const i = (y * img.width + x) * 3;
    const f = ((img.data[i] << 8) | img.data[i + 1]) / 65535;
    return relief.minKm + f * (relief.maxKm - relief.minKm);
  };
  const latOf = (y: number): number => 90 - ((y + 0.5) * 180) / img.height;
  const lonOf = (x: number): number => (180 + ((x + 0.5) * 360) / img.width) % 360;

  return {
    width: img.width,
    height: img.height,
    at(latDeg, lonEast) {
      const u = ((((lonEast - 180) / 360) % 1) + 1) % 1;
      const x = Math.min(img.width - 1, Math.round(u * img.width));
      const y = Math.min(
        img.height - 1,
        Math.max(0, Math.round(((90 - latDeg) / 180) * img.height)),
      );
      return kmAt(x, y);
    },
    mean(accept) {
      let sum = 0;
      let weight = 0;
      for (let y = 0; y < img.height; y++) {
        const lat = latOf(y);
        const w = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < img.width; x++) {
          if (!accept(lat, lonOf(x))) {
            continue;
          }
          sum += kmAt(x, y) * w;
          weight += w;
        }
      }
      return weight > 0 ? sum / weight : NaN;
    },
    extremes() {
      let hi = -Infinity;
      let lo = Infinity;
      let hiAt: [number, number] = [0, 0];
      let loAt: [number, number] = [0, 0];
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const km = kmAt(x, y);
          if (km > hi) {
            hi = km;
            hiAt = [latOf(y), lonOf(x)];
          }
          if (km < lo) {
            lo = km;
            loAt = [latOf(y), lonOf(x)];
          }
        }
      }
      return { hiAt, loAt };
    },
  };
}
