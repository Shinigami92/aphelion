/** Shape models of small irregular bodies, turned into relief maps. */

import type { ReliefResult } from './relief.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download, mb, SHAPES } from './io.ts';
import { encodePng } from './png.ts';
import { rasteriseCubeQuad, sampleLatLonTable } from './shape-sampling.ts';

/**
 * Shape models, for bodies too irregular for "elevation above a datum" to mean
 * anything. Same output format as the raster grids above — an equirectangular
 * map of offsets from the body's mean radius — so the renderer needs no second
 * code path. The conversion is the whole job: these arrive as a cube of
 * vertices, not as a lat/lon grid.
 */
export interface ShapeModelSpec {
  body: string;
  out: string;
  url: string;
  /**
   * How the model is laid out. `cube-quad` is Gaskell's six-face vertex cube;
   * `lat-lon-table` is Thomas's plain latitude/longitude/radius text, which is
   * already the shape this pipeline wants and needs only resampling.
   */
  format: 'cube-quad' | 'lat-lon-table';
  width: number;
  height: number;
  /**
   * Radius the offsets are measured from, km. Must match the radius the app
   * gives this body, or the shape inflates or shrinks uniformly.
   */
  referenceRadiusKm: number;
  credit: string;
  note: string;
}

export const SHAPE_MODELS: ShapeModelSpec[] = [
  {
    body: 'moon:Phobos',
    out: 'phobos_relief.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/gaskell.phobos.shape-model/data/phobos_quad128q.tab',
    format: 'cube-quad',
    // The model's own spacing is ~0.12 km, which on an 11 km body is 0.63
    // degrees of arc — so 512 x 256 (0.70 deg/px) samples it about right and
    // anything finer would just interpolate.
    width: 512,
    height: 256,
    referenceRadiusKm: 11.08,
    credit: 'Gaskell Phobos shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, 6 x 129² vertices',
  },
  // Cassini-derived Gaskell models for the Saturnians whose defining feature is
  // a crater big enough to change the body's outline — Herschel on Mimas is 139
  // km across on a 198 km moon, Odysseus on Tethys 450 km on a 531 km one.
  // Rendered as spheres they lose exactly the thing they are known for.
  {
    body: 'moon:Mimas',
    out: 'mimas_relief.png',
    url: 'https://sbnarchive.psi.edu/pds3/multi_mission/CO_SA_ISSNA_5_MIMASSHAPE_V2_0/data/mimas_quad128q.tab',
    format: 'cube-quad',
    width: 512,
    height: 256,
    referenceRadiusKm: 198.2,
    credit: 'Cassini ISS Mimas shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, Cassini ISS',
  },
  {
    body: 'moon:Tethys',
    out: 'tethys_relief.png',
    url: 'https://sbnarchive.psi.edu/pds3/multi_mission/CO_SA_ISSNA_5_TETHYSSHAPE_V1_0/data/tethys_quad128q.tab',
    format: 'cube-quad',
    width: 512,
    height: 256,
    referenceRadiusKm: 531.1,
    credit: 'Cassini ISS Tethys shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, Cassini ISS',
  },
  {
    body: 'moon:Dione',
    out: 'dione_relief.png',
    url: 'https://sbnarchive.psi.edu/pds3/multi_mission/CO_SA_ISSNA_ISSWA_5_DIONESHAPE_V1_0/data/dione_quad128q.tab',
    format: 'cube-quad',
    width: 512,
    height: 256,
    referenceRadiusKm: 561.4,
    credit: 'Cassini ISS Dione shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, Cassini ISS',
  },
  {
    body: 'moon:Phoebe',
    out: 'phoebe_relief.png',
    url: 'https://sbnarchive.psi.edu/pds3/multi_mission/CO_SA_ISSNA_5_PHOEBESHAPE_V2_0/data/phoebe_quad128q.tab',
    format: 'cube-quad',
    width: 512,
    height: 256,
    referenceRadiusKm: 106.5,
    credit: 'Cassini ISS Phoebe shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, Cassini ISS',
  },
  {
    body: 'sb:Eros',
    out: 'eros_relief.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/gaskell.ast-eros.shape-model_V1_1/data/quad/quad128q.tab',
    format: 'cube-quad',
    width: 512,
    height: 256,
    // NEAR orbited Eros for a year, so this is among the best-resolved shapes of
    // any small body. 34 x 11 x 11 km — the most elongated thing in the app.
    referenceRadiusKm: 8.42,
    credit: 'Gaskell Eros shape model (NEAR) — PDS Small Bodies Node',
    note: 'Gaskell 128q, NEAR',
  },
  {
    body: 'sb:Vesta',
    out: 'vesta_relief.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/4vesta.tab',
    format: 'lat-lon-table',
    width: 256,
    height: 128,
    // Vesta's radius in our catalogue is derived from absolute magnitude, which
    // overestimates it by nearly half; SMALL_BODY_RADII overrides it with the
    // measured value so the shape reconstructs at the right size.
    referenceRadiusKm: 262.7,
    credit: 'Thomas Vesta shape model — PDS Small Bodies Node',
    note: 'Thomas HST model, 5 deg grid',
  },
  {
    body: 'moon:Deimos',
    out: 'deimos_relief.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimos.tab',
    format: 'lat-lon-table',
    // The source is a 5 degree grid — Viking is the only spacecraft that ever
    // imaged Deimos properly, so this is the whole of what has been measured.
    // Output is finer only so the differenced normals do not facet at high LOD;
    // bilinear interpolation adds no detail that is not already in the table.
    width: 256,
    height: 128,
    referenceRadiusKm: 6.2,
    credit: 'Thomas Deimos shape model (Viking) — PDS Small Bodies Node',
    note: 'Thomas Viking model, 5 deg grid',
  },
];

/**
 * Resample a Gaskell cube-quad shape model onto the equirectangular grid the
 * renderer already understands.
 *
 * The file is six square faces of (N+1)² vertices in body-fixed kilometres —
 * verified here rather than assumed, because a wrong row/column order would
 * still parse and would still produce a closed surface, just not this body's.
 * Each face's cells are split into triangles and scan-converted in latitude and
 * longitude, interpolating radius barycentrically; because the faces tile the
 * whole surface, every output pixel centre falls inside some triangle and the
 * map comes out hole-free except at the poles, where the projection is singular.
 *
 * Longitude here is measured from the model's own +x axis, matching the IAU
 * frame the colour mosaic uses, so relief and albedo stay registered with each
 * other whatever the render frame does with the pair.
 */
export async function buildShapeModel(spec: ShapeModelSpec): Promise<ReliefResult | null> {
  const cachePath = path.join(CACHE, path.basename(spec.url));
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
    return null;
  }

  const text = await fs.readFile(cachePath, 'utf8');
  const radii =
    spec.format === 'lat-lon-table' ? sampleLatLonTable(spec, text) : rasteriseCubeQuad(spec, text);
  if (!radii) {
    return null;
  }
  return finishShape(spec, radii);
}

/**
 * Turn absolute radii into offsets from the body's mean radius and encode them.
 *
 * The reference must be the radius the app gives this body, not the model's own
 * mean: the shader reconstructs `radiusKm + offset`, so matching them makes the
 * rendered figure exactly the modelled one, and a mismatch inflates or shrinks
 * the whole body uniformly.
 */
async function finishShape(
  spec: ShapeModelSpec,
  radii: Float64Array,
): Promise<ReliefResult | null> {
  const w = spec.width;
  const h = spec.height;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < radii.length; i++) {
    const v = radii[i] - spec.referenceRadiusKm;
    radii[i] = v;
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }

  const span = max - min;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < radii.length; i++) {
    const t = Math.round(((radii[i] - min) / span) * 65535);
    rgb[i * 3] = (t >> 8) & 0xff;
    rgb[i * 3 + 1] = t & 0xff;
  }

  await fs.mkdir(SHAPES, { recursive: true });
  const png = encodePng(w, h, rgb);
  await fs.writeFile(path.join(SHAPES, spec.out), png);
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h}, ${min.toFixed(2)}..${max.toFixed(2)} km about r=${spec.referenceRadiusKm}, ${mb(png.length)}`,
    )}`,
  );

  return {
    body: spec.body,
    out: spec.out,
    width: w,
    height: h,
    minKm: min,
    maxKm: max,
    credit: spec.credit,
  };
}
