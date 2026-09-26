/** Paths, console colours, downloads and the image conversion queue. */

import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * ImageMagick is already a hard requirement of `pnpm assets` through
 * scripts/convert-textures.sh; this uses it only as a rasteriser and decoder,
 * because a scanned map sheet arrives as PDF and nothing here can decode one.
 */
export async function execFile(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  // Hand-rolled rather than util.promisify(execFile): the promisified overload
  // types the callback-style original as returning void, which it does not.
  return new Promise((resolve, reject) => {
    execFileCb(file, args, (err, stdout, stderr) => {
      if (err instanceof Error) {
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Two levels up: this module lives in scripts/assets/.
const ROOT = path.resolve(import.meta.dirname, '..', '..');

export const CACHE = path.join(ROOT, '.cache');

export const TEXTURES = path.join(ROOT, 'public', 'textures');

export const SHAPES = path.join(ROOT, 'public', 'shapes');

export const SKY = path.join(ROOT, 'public', 'sky');

export const GENERATED = path.join(ROOT, 'src', 'data', 'generated');

export const QUEUE = path.join(CACHE, 'convert-queue.tsv');

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Aphelion/1.0';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export const C = {
  dim: (s: string): string => `\u001B[2m${s}\u001B[0m`,
  bold: (s: string): string => `\u001B[1m${s}\u001B[0m`,
  green: (s: string): string => `\u001B[32m${s}\u001B[0m`,
  yellow: (s: string): string => `\u001B[33m${s}\u001B[0m`,
  red: (s: string): string => `\u001B[31m${s}\u001B[0m`,
  cyan: (s: string): string => `\u001B[36m${s}\u001B[0m`,
};

export const step = (msg: string): void => {
  console.log(`\n${C.bold(`> ${msg}`)}`);
};

export const mb = (n: number): string => `${(n / 1_048_576).toFixed(1)} MB`;

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Download to a cache path, skipping the request if it is already there. */
export async function download(url: string, dest: string, label: string): Promise<boolean> {
  if (await exists(dest)) {
    const st = await fs.stat(dest);
    if (st.size > 0) {
      console.log(`  ${C.dim('cached ')} ${label} ${C.dim(mb(st.size))}`);
      return true;
    }
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  process.stdout.write(`  ${C.cyan('fetch  ')} ${label} ... `);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.log(C.red(`HTTP ${res.status}`));
      return false;
    }
    const ct = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    // Solar System Scope answers unknown filenames with a 200 HTML page.
    if (/text\/html/iu.test(ct)) {
      console.log(C.red('got HTML, not an asset'));
      return false;
    }
    await fs.writeFile(dest, buf);
    console.log(C.green(mb(buf.length)));
    return true;
  } catch (err) {
    console.log(C.red(`failed: ${err instanceof Error ? err.message : String(err)}`));
    return false;
  }
}

export async function fetchText(
  url: string,
  cacheName: string,
  label: string,
): Promise<string | null> {
  const dest = path.join(CACHE, cacheName);
  if (!(await download(url, dest, label))) {
    return null;
  }
  return fs.readFile(dest, 'utf8');
}

/**
 * Queue an image for format conversion / downsampling by the shell helper.
 *
 * `roll` shifts a map whose left edge is not 180 west; `flop` mirrors one whose
 * longitude runs the other way (the SVS sky maps, where RA increases to the
 * left). Both are applied at build time rather than in a shader, so every
 * equirectangular image in public/ shares one convention.
 */
export const convertQueue: string[] = [];

export function queueConvert(
  src: string,
  dest: string,
  maxDim: number,
  roll = '',
  flop = false,
): void {
  // Both go in one comma-separated field rather than a column each. `read`
  // treats tab as whitespace, and whitespace in IFS collapses runs of it into a
  // single separator -- so an empty `roll` column would silently shift `flop`
  // one place left and the image would come out un-mirrored, which is a thing
  // you can only detect by measuring the sky it produces.
  const ops = [roll ? `roll:${roll}` : '', flop ? 'flop' : ''].filter(Boolean).join(',');
  convertQueue.push(`${src}\t${dest}\t${maxDim}\t${ops}`);
  console.log(`  ${C.dim('queued ')} ${path.basename(dest)} ${C.dim(`<= ${path.basename(src)}`)}`);
}
