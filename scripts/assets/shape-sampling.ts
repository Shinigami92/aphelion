/** Sampling a shape model onto a latitude/longitude grid. */

import type { ShapeModelSpec } from './shape-models.ts';
import { C } from './io.ts';

/**
 * Resample a latitude/longitude/radius table onto the output grid.
 *
 * The table is a regular grid, so this is a bilinear lookup — but two of its
 * conventions are the reverse of ours and both are silent if missed: rows run
 * south to north where our maps put north first, and longitudes start at the
 * prime meridian where our maps start at 180 west. Driving the output loop from
 * the target's own coordinates rather than the source's makes both fall out.
 */
export function sampleLatLonTable(spec: ShapeModelSpec, text: string): Float64Array | null {
  const rows: Array<[number, number, number]> = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    const p = t.split(/\s+/u).map(Number);
    if (p.length < 3 || p.some((v) => !Number.isFinite(v))) {
      console.log(`  ${C.red('bad    ')} ${spec.out}: unparseable row "${t.slice(0, 40)}"`);
      return null;
    }
    rows.push([p[0], p[1], p[2]]);
  }

  const lats = [...new Set(rows.map((r) => r[0]))].toSorted((a, b) => a - b);
  const lons = [...new Set(rows.map((r) => r[1]))].toSorted((a, b) => a - b);
  if (lats.length * lons.length !== rows.length) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: ${rows.length} rows is not ${lats.length} x ${lons.length}`,
    );
    return null;
  }

  const latIx = new Map(lats.map((v, i) => [v, i]));
  const lonIx = new Map(lons.map((v, i) => [v, i]));
  const grid = new Float64Array(lats.length * lons.length);
  for (const [la, lo, r] of rows) {
    grid[latIx.get(la)! * lons.length + lonIx.get(lo)!] = r;
  }

  const latMin = lats[0];
  const latStep = (lats.at(-1)! - latMin) / (lats.length - 1);
  const lonMin = lons[0];
  const lonStep = (lons.at(-1)! - lonMin) / (lons.length - 1);

  const sample = (lat: number, lon: number): number => {
    const fy = Math.min(lats.length - 1.0001, Math.max(0, (lat - latMin) / latStep));
    const fx = Math.min(lons.length - 1.0001, Math.max(0, (lon - lonMin) / lonStep));
    const y0 = Math.floor(fy);
    const x0 = Math.floor(fx);
    const ty = fy - y0;
    const tx = fx - x0;
    const g = (y: number, x: number): number => grid[y * lons.length + x];
    return (
      g(y0, x0) * (1 - tx) * (1 - ty) +
      g(y0, x0 + 1) * tx * (1 - ty) +
      g(y0 + 1, x0) * (1 - tx) * ty +
      g(y0 + 1, x0 + 1) * tx * ty
    );
  };

  const out = new Float64Array(spec.width * spec.height);
  for (let y = 0; y < spec.height; y++) {
    const lat = 90 - ((y + 0.5) * 180) / spec.height;
    for (let x = 0; x < spec.width; x++) {
      const lon = (180 + ((x + 0.5) * 360) / spec.width) % 360;
      out[y * spec.width + x] = sample(lat, lon);
    }
  }
  return out;
}

export function rasteriseCubeQuad(spec: ShapeModelSpec, text: string): Float64Array | null {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const n = Number(lines[0].trim());
  const side = n + 1;
  const perFace = side * side;
  if (!Number.isFinite(n) || lines.length - 1 !== 6 * perFace) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: header says ${n}, expected ${6 * perFace} vertices, got ${lines.length - 1}`,
    );
    return null;
  }

  const vx = new Float64Array(6 * perFace);
  const vy = new Float64Array(6 * perFace);
  const vz = new Float64Array(6 * perFace);
  for (let i = 0; i < 6 * perFace; i++) {
    const parts = lines[i + 1].trim().split(/\s+/u);
    vx[i] = Number(parts[0]);
    vy[i] = Number(parts[1]);
    vz[i] = Number(parts[2]);
  }

  // Guard the layout assumption: on a regular grid, stepping one column is a
  // short hop. A shuffled ordering would jump across the body instead.
  let longest = 0;
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i + 1 < side; i++) {
        const k = f * perFace + j * side + i;
        longest = Math.max(
          longest,
          Math.hypot(vx[k] - vx[k + 1], vy[k] - vy[k + 1], vz[k] - vz[k + 1]),
        );
      }
    }
  }
  if (longest > spec.referenceRadiusKm * 0.25) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: grid neighbours up to ${longest.toFixed(2)} km apart`,
    );
    return null;
  }

  const w = spec.width;
  const h = spec.height;
  const radii = new Float64Array(w * h);
  const filled = new Uint8Array(w * h);

  const lonOf = (i: number): number => {
    const d = (Math.atan2(vy[i], vx[i]) * 180) / Math.PI;
    return d < 0 ? d + 360 : d;
  };
  const latOf = (i: number): number => {
    const r = Math.hypot(vx[i], vy[i], vz[i]);
    return (Math.asin(vz[i] / r) * 180) / Math.PI;
  };
  const radOf = (i: number): number => Math.hypot(vx[i], vy[i], vz[i]);

  const rasteriseTriangle = (a: number, b: number, c: number): void => {
    let l0 = lonOf(a);
    let l1 = lonOf(b);
    let l2 = lonOf(c);
    // A triangle straddling the 0/360 seam looks 350 degrees wide; put all three
    // on one branch so it is a degree wide again.
    if (Math.max(l0, l1, l2) - Math.min(l0, l1, l2) > 180) {
      if (l0 < 180) {
        l0 += 360;
      }
      if (l1 < 180) {
        l1 += 360;
      }
      if (l2 < 180) {
        l2 += 360;
      }
    }
    const t0 = latOf(a);
    const t1 = latOf(b);
    const t2 = latOf(c);
    const r0 = radOf(a);
    const r1 = radOf(b);
    const r2 = radOf(c);

    const det = (l1 - l0) * (t2 - t0) - (l2 - l0) * (t1 - t0);
    if (Math.abs(det) < 1e-12) {
      return;
    }

    const x0 = Math.floor(((Math.min(l0, l1, l2) - 180) / 360) * w - 0.5);
    const x1 = Math.ceil(((Math.max(l0, l1, l2) - 180) / 360) * w - 0.5);
    const y0 = Math.max(0, Math.floor(((90 - Math.max(t0, t1, t2)) / 180) * h - 0.5));
    const y1 = Math.min(h - 1, Math.ceil(((90 - Math.min(t0, t1, t2)) / 180) * h - 0.5));

    for (let y = y0; y <= y1; y++) {
      const lat = 90 - ((y + 0.5) * 180) / h;
      for (let x = x0; x <= x1; x++) {
        const lon = 180 + ((x + 0.5) * 360) / w;
        const u = ((l1 - lon) * (t2 - lat) - (l2 - lon) * (t1 - lat)) / det;
        const v = ((l2 - lon) * (t0 - lat) - (l0 - lon) * (t2 - lat)) / det;
        const t = 1 - u - v;
        if (u < -1e-9 || v < -1e-9 || t < -1e-9) {
          continue;
        }
        const col = ((x % w) + w) % w;
        radii[y * w + col] = u * r0 + v * r1 + t * r2;
        filled[y * w + col] = 1;
      }
    }
  };

  for (let f = 0; f < 6; f++) {
    for (let j = 0; j + 1 < side; j++) {
      for (let i = 0; i + 1 < side; i++) {
        const k = f * perFace + j * side + i;
        rasteriseTriangle(k, k + 1, k + side);
        rasteriseTriangle(k + 1, k + side + 1, k + side);
      }
    }
  }

  // The projection is singular at the poles, so a handful of pixels there can
  // fall outside every triangle. Fill them from their filled neighbours.
  const filledNeighbourMean = (x: number, y: number): number | null => {
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) {
          continue;
        }
        const nx = (((x + dx) % w) + w) % w;
        if (!filled[ny * w + nx]) {
          continue;
        }
        sum += radii[ny * w + nx];
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  };
  let holes = 0;
  for (let pass = 0; pass < 8; pass++) {
    holes = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (filled[y * w + x]) {
          continue;
        }
        const mean = filledNeighbourMean(x, y);
        if (mean === null) {
          holes++;
        } else {
          radii[y * w + x] = mean;
          filled[y * w + x] = 2;
        }
      }
    }
    for (let i = 0; i < filled.length; i++) {
      if (filled[i] === 2) {
        filled[i] = 1;
      }
    }
    if (holes === 0) {
      break;
    }
  }
  if (holes > 0) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: ${holes} pixels never covered`);
    return null;
  }
  return radii;
}
