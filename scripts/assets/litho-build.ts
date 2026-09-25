/** Building a moon map from one lithographed sheet. */

import type { LithoMosaicSpec } from './litho.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download, mb, TEXTURES } from './io.ts';
import { bridge, LITHO_PAPER, pageSize, rasterise } from './litho.ts';
import { encodePng } from './png.ts';

export async function buildLithoMosaic(spec: LithoMosaicSpec): Promise<boolean> {
  const cachePath = path.join(CACHE, path.basename(spec.url));
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
    return false;
  }

  const [pageW, pageH] = await pageSize(cachePath);
  const pad = Math.round(spec.radius * 1.24);
  const rx = Math.max(0, Math.round(spec.centreX) - pad);
  const ry = Math.max(0, Math.round(spec.centreY) - pad);
  const w = Math.min(pageW - rx, pad * 2);
  const h = Math.min(pageH - ry, pad * 2);
  const crop = { x: rx, y: ry, w, h };

  const rawPath = path.join(CACHE, `litho-${spec.body}.gray`);
  const medPath = path.join(CACHE, `litho-${spec.body}-median.gray`);
  await rasterise(cachePath, crop, [], rawPath);
  // A second copy with thin ink removed, used only to tell paper from imagery.
  // The graticule is a closed curve, so on the raw scan it walls the unimaged
  // paper *inside* the latitude-0 circle off from the paper outside it, and a
  // flood fill never reaches it. The window has to beat the widest line on the
  // sheet: at 5 px the outer circle survived and sealed off wedges of blank
  // paper between the meridians, which came through as white blocks.
  await rasterise(cachePath, crop, ['-statistic', 'Median', '13x13'], medPath);

  const px = await fs.readFile(rawPath);
  const med = await fs.readFile(medPath);
  if (px.length !== w * h || med.length !== w * h) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: expected ${w * h} px, got ${px.length}/${med.length}`,
    );
    return false;
  }
  const cx = spec.centreX - rx;
  const cy = spec.centreY - ry;

  // Bare paper: near-white and reachable from the edge of the crop. Bright
  // terrain inside the mosaic is just as white but is not connected to it.
  const paper = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return;
    }
    const i = y * w + x;
    if (paper[i] || med[i] < LITHO_PAPER) {
      return;
    }
    paper[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Take the graticule back off, in source space, by pulling each line's pixels
  // from just beyond it at right angles. Masking the lines during resampling
  // instead leaves a tapered wedge along every meridian, because the masked band
  // subtends more and more longitude as it approaches the pole.
  const src = Uint8Array.from(px);
  const get = (x: number, y: number): number => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) {
      return -1;
    }
    return px[yi * w + xi];
  };
  const put = (x: number, y: number, v: number): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h || v < 0) {
      return;
    }
    src[yi * w + xi] = v;
  };
  const latRadii = [0, -30, -60].map(
    (lat) => spec.radius * Math.tan((((90 + lat) / 2) * Math.PI) / 180),
  );
  for (const r of latRadii) {
    const steps = Math.ceil(2 * Math.PI * r * 2);
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      bridge(
        (d) => get(cx + (r + d) * st, cy - (r + d) * ct),
        (d, v) => {
          put(cx + (r + d) * st, cy - (r + d) * ct, v);
        },
        26,
        0.5,
      );
    }
  }
  for (let k = 0; k < 12; k++) {
    const t = (k * 30 * Math.PI) / 180;
    for (let r = 4; r <= spec.radius * 1.02; r += 0.5) {
      bridge(
        (d) => get(cx + r * Math.sin(t + d / r), cy - r * Math.cos(t + d / r)),
        (d, v) => {
          put(cx + r * Math.sin(t + d / r), cy - r * Math.cos(t + d / r), v);
        },
        Math.min(26, r * 0.5),
        0.4,
      );
    }
  }

  // Reproject. Polar stereographic about the south pole: a point at colatitude
  // theta from that pole sits at radius R*tan(theta/2), with longitude running
  // clockwise from 0 at the top of the sheet. That the law really is
  // stereographic was read off the sheet rather than assumed -- the printed
  // circles fall at 0.260 and 0.573 of the outer one, against tan-law
  // predictions of 0.268 and 0.577, where an equidistant projection would put
  // them at 0.333 and 0.667.
  const outW = 2048;
  const outH = 1024;
  const grid = 6;
  const out = new Uint8Array(outW * outH);
  const known = new Uint8Array(outW * outH);
  // Mean of the non-paper sheet pixels on a grid x grid patch over one output
  // cell's footprint, or null when none of them landed on imagery.
  const footprintMean = (rho: number, a: number, dRho: number, dLon: number): number | null => {
    let acc = 0;
    let n = 0;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const r2 = rho + ((i + 0.5) / grid - 0.5) * dRho;
        const t2 = a + (((j + 0.5) / grid - 0.5) * dLon) / Math.max(rho, 1);
        const xi = Math.round(cx + r2 * Math.sin(t2));
        const yi = Math.round(cy - r2 * Math.cos(t2));
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) {
          continue;
        }
        const k = yi * w + xi;
        if (paper[k]) {
          continue;
        }
        acc += src[k];
        n++;
      }
    }
    return n > 0 ? acc / n : null;
  };
  let sum = 0;
  let count = 0;
  for (let oy = 0; oy < outH; oy++) {
    const lat = 90 - ((oy + 0.5) / outH) * 180;
    // Stop at the equator. A few of the mosaics overrun it slightly, but past
    // the latitude-0 circle the sheet carries its own furniture, and its
    // "CONTROLLED PHOTOMOSAIC OF ..." caption sits due south of the disc, so
    // reaching beyond the circle prints the sheet's own words along the edges
    // of the map.
    if (lat > 0) {
      continue;
    }
    const theta = ((90 + lat) * Math.PI) / 180;
    const rho = spec.radius * Math.tan(theta / 2);
    const dRho = Math.abs(spec.radius * Math.tan((theta + Math.PI / outH) / 2) - rho) + 1;
    for (let ox = 0; ox < outW; ox++) {
      const a = ((-180 + ((ox + 0.5) / outW) * 360) * Math.PI) / 180;
      const dLon = ((2 * Math.PI) / outW) * rho;
      const mean = footprintMean(rho, a, dRho, dLon);
      if (mean === null) {
        continue;
      }
      const v = Math.round(mean);
      const oi = oy * outW + ox;
      out[oi] = v;
      known[oi] = 1;
      sum += v;
      count++;
    }
  }

  // Unimaged ground is flattened rather than smeared, the same as Deimos's: a
  // flat field reads as "nothing was seen here", where dilating the neighbours
  // would invent surface. For these bodies that is half the world -- Voyager 2
  // arrived at southern summer solstice and the northern hemispheres were in
  // polar night.
  const fill = count ? Math.round(sum / count) : 128;
  for (let i = 0; i < out.length; i++) {
    if (!known[i]) {
      out[i] = fill;
    }
  }

  await fs.mkdir(TEXTURES, { recursive: true });
  const png = encodePng(outW, outH, Buffer.from(out), 1);
  await fs.writeFile(path.join(TEXTURES, spec.out), png);
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${outW}x${outH} grey, ${((count / out.length) * 100).toFixed(1)}% imaged, ${mb(png.length)}`,
    )}`,
  );
  return true;
}
