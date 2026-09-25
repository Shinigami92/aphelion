/**
 * One-time asset + data acquisition.
 *
 *   pnpm assets                  everything (fetch → convert → manifest)
 *   pnpm assets:data             just regenerate the ephemeris data modules
 *   pnpm assets:textures         just the imagery
 *   node scripts/fetch-assets.ts --skip-usgs    skip the huge moon mosaics
 *   node scripts/fetch-assets.ts --tier=lean    2k textures instead of 8k
 *
 * This is the ONLY part of Aphelion that touches the network. It downloads
 * public-domain / CC-BY source material and generates committed TypeScript data
 * modules, so the app itself never makes a request to anything.
 *
 * Image format conversion (the source normal maps and USGS mosaics are TIFF,
 * which browsers cannot read) is queued to `.cache/convert-queue.tsv` and
 * carried out by scripts/convert-textures.sh, keeping this script pure I/O.
 *
 * Sources
 *   - Solar System Scope planetary maps (CC BY 4.0)
 *   - USGS Astrogeology global mosaics (public domain)
 *   - PDS Geosciences Node global elevation grids (public domain)
 *   - JPL Solar System Dynamics satellite elements + physical parameters
 *   - IAU Minor Planet Center MPCORB / Distant.txt orbit catalogues
 */

import type { ReliefResult } from './assets/relief.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { doData, doRelief, doTextures, manifestOnly, skipUsgs, tier } from './assets/cli.ts';
import { buildFitsMosaic, FITS_MOSAICS } from './assets/fits.ts';
import { buildGriddedTopo, GRIDDED_TOPO } from './assets/gridded-topo.ts';
import {
  C,
  CACHE,
  convertQueue,
  download,
  exists,
  QUEUE,
  queueConvert,
  step,
  TEXTURES,
} from './assets/io.ts';
import { buildLithoMosaic } from './assets/litho-build.ts';
import { LITHO_MOSAICS } from './assets/litho.ts';
import { writeManifest } from './assets/manifest.ts';
import { writeReliefModule } from './assets/relief-module.ts';
import { buildRelief, RELIEF } from './assets/relief.ts';
import { buildSatelliteData, writeSatelliteModule } from './assets/satellites.ts';
import { buildShapeModel, SHAPE_MODELS } from './assets/shape-models.ts';
import { buildSmallBodyData, writeSmallBodyModule } from './assets/small-bodies.ts';
import { writeStarCatalogue } from './assets/stars-file.ts';
import { buildStarCatalogue } from './assets/stars.ts';
import {
  ASTROPEDIA,
  astropediaImageUrl,
  skyTextures,
  SSS_BASE,
  sssTextures,
  SVS_BASE,
  USGS,
} from './assets/textures.ts';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(C.bold('\nAphelion asset pipeline'));

  await fs.mkdir(CACHE, { recursive: true });
  await fs.mkdir(TEXTURES, { recursive: true });

  if (manifestOnly) {
    step('Texture manifest');
    await writeManifest();
    console.log('');
    return;
  }

  console.log(C.dim(`tier=${tier}  usgs=${skipUsgs ? 'skipped' : 'on'}`));
  const failures: string[] = [];

  if (doTextures) {
    step('Solar System Scope planetary maps (CC BY 4.0)');
    for (const spec of sssTextures()) {
      const outPath = path.join(TEXTURES, spec.out);
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`);
        continue;
      }
      let done = false;
      for (const cand of spec.candidates) {
        const cachePath = path.join(CACHE, cand);
        if (!(await download(SSS_BASE + cand, cachePath, cand))) {
          continue;
        }
        if (/\.tif$/iu.test(cand)) {
          queueConvert(cachePath, outPath, spec.convertTo ?? 4096);
        } else {
          await fs.copyFile(cachePath, outPath);
        }
        done = true;
        break;
      }
      if (!done) {
        failures.push(spec.out);
      }
    }

    step('NASA SVS Deep Star Maps 2020 (public domain)');
    for (const spec of skyTextures()) {
      const outPath = path.join(TEXTURES, spec.out);
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`);
        continue;
      }
      const cachePath = path.join(CACHE, spec.source);
      if (!(await download(SVS_BASE + spec.source, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
        failures.push(spec.out);
        continue;
      }
      // Mirrored, because right ascension runs the other way on this product.
      queueConvert(cachePath, outPath, spec.maxDim, '', true);
    }

    if (skipUsgs) {
      step('USGS mosaics -- skipped (--skip-usgs)');
    } else {
      step('USGS Astrogeology global mosaics (public domain)');
      console.log(C.dim('  large source GeoTIFFs, downsampled to 4k during conversion'));
      for (const spec of USGS) {
        const outPath = path.join(TEXTURES, spec.out);
        if (await exists(outPath)) {
          console.log(`  ${C.dim('have   ')} ${spec.out}`);
          continue;
        }
        const cachePath = path.join(CACHE, path.basename(spec.url));
        if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
          failures.push(spec.out);
          continue;
        }
        queueConvert(cachePath, outPath, spec.maxDim, spec.roll);
      }
    }

    step('USGS Astropedia mosaics (public domain)');
    for (const spec of ASTROPEDIA) {
      const outPath = path.join(TEXTURES, spec.out);
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`);
        continue;
      }
      const url = await astropediaImageUrl(spec);
      if (url === null) {
        failures.push(spec.out);
        continue;
      }
      const cachePath = path.join(CACHE, `astropedia-${spec.out}`);
      if (!(await download(url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
        failures.push(spec.out);
        continue;
      }
      // These arrive as browse JPEGs at sane sizes, so no conversion is needed.
      await fs.copyFile(cachePath, outPath);
    }

    step('PDS FITS mosaics (public domain)');
    for (const spec of FITS_MOSAICS) {
      const outPath = path.join(TEXTURES, spec.out);
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`);
        continue;
      }
      if (!(await buildFitsMosaic(spec))) {
        failures.push(spec.out);
      }
    }

    step('USGS lithographed photomosaics (public domain)');
    for (const spec of LITHO_MOSAICS) {
      const outPath = path.join(TEXTURES, spec.out);
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`);
        continue;
      }
      if (!(await buildLithoMosaic(spec))) {
        failures.push(spec.out);
      }
    }
  }

  if (doRelief) {
    step('Global topography (public domain)');
    const relief: ReliefResult[] = [];
    for (const spec of RELIEF) {
      const result = await buildRelief(spec);
      if (result) {
        relief.push(result);
      } else {
        failures.push(spec.out);
      }
    }
    for (const spec of GRIDDED_TOPO) {
      const result = await buildGriddedTopo(spec);
      if (result) {
        relief.push(result);
      } else {
        failures.push(spec.out);
      }
    }
    for (const spec of SHAPE_MODELS) {
      const result = await buildShapeModel(spec);
      if (result) {
        relief.push(result);
      } else {
        failures.push(spec.out);
      }
    }
    // Rewrite only on a complete run: the module mirrors the tables exactly, so
    // publishing a partial set would silently drop maps that are still on disk.
    if (relief.length === RELIEF.length + GRIDDED_TOPO.length + SHAPE_MODELS.length) {
      await writeReliefModule(relief);
    } else {
      console.log(C.yellow('  incomplete; existing relief module left in place'));
    }
  }

  if (doData) {
    step('JPL satellite ephemerides');
    const sats = await buildSatelliteData();
    if (sats && sats.length > 0) {
      await writeSatelliteModule(sats);
    } else {
      console.log(C.yellow('  could not build satellite data; existing module left in place'));
      failures.push('satellites.ts');
    }

    step('Minor Planet Center orbit catalogues');
    const bodies = await buildSmallBodyData();
    if (bodies && bodies.length > 0) {
      await writeSmallBodyModule(bodies);
    } else {
      console.log(C.yellow('  could not build small-body data; existing module left in place'));
      failures.push('smallbodies.ts');
    }

    step('Hipparcos star catalogue (ESA 1997)');
    const stars = await buildStarCatalogue();
    if (stars) {
      await writeStarCatalogue(stars);
    } else {
      console.log(C.yellow('  could not build the star catalogue; existing files left in place'));
      failures.push('stars.bin');
    }
  }

  await fs.writeFile(QUEUE, convertQueue.length > 0 ? `${convertQueue.join('\n')}\n` : '');

  step('Texture manifest');
  await writeManifest();

  console.log('');
  if (convertQueue.length > 0) {
    console.log(
      C.yellow(`${convertQueue.length} image(s) need conversion — run scripts/convert-textures.sh`),
    );
    console.log(C.dim('(`pnpm assets` does this for you; re-run the manifest step afterwards)'));
  }
  if (failures.length > 0) {
    console.log(C.yellow(`Missing asset(s): ${failures.join(', ')}`));
    console.log(C.dim('Missing textures fall back to procedural generation at runtime.'));
  } else if (convertQueue.length === 0) {
    console.log(C.green('All assets present.'));
  }
  console.log('');
}

try {
  await main();
} catch (err) {
  const detail = err instanceof Error ? (err.stack ?? String(err)) : String(err);
  console.error(C.red(`\nfetch-assets failed: ${detail}`));
  process.exit(1);
}
