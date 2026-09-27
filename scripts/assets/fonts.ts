/**
 * MSDF font atlases for the in-headset UI.
 *
 * The VR panels draw text with @pmndrs/uikit, which renders multichannel signed
 * distance field glyphs from a BMFont description plus one atlas image. Its
 * bundled fonts carry only 104 ASCII glyphs, and Aphelion's formatters print
 * more than that: `×` and superscript exponents in masses, `·` separators, en
 * and em dashes, the true minus sign, degrees. So the atlases are built here,
 * from pinned OFL releases, with a character set that covers what the app says.
 *
 * Each font becomes a module under src/data/generated/fonts/ that exports the
 * BMFont JSON with its atlas inlined as a data URL. The UI imports them lazily,
 * so they land in the VR chunk, which the service worker precaches like any
 * other script, and nothing is fetched at run time.
 */

import generateBMFont from 'msdf-bmfont-xml';
import fs from 'node:fs/promises';
import path from 'node:path';
import { C, CACHE, download, GENERATED } from './io.ts';
import { unzipEntry } from './zip.ts';

interface FontSource {
  /** Module and export name stem, e.g. `inter-regular` → INTER_REGULAR. */
  key: string;
  url: string;
  /** For an archive: the path fragment of the TTF inside it. */
  entry?: string;
  licence: string;
}

const INTER_ZIP = 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip';
const JETBRAINS_MONO = 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf';

const FONT_SOURCES: FontSource[] = [
  {
    key: 'inter-regular',
    url: INTER_ZIP,
    entry: 'extras/ttf/Inter-Regular.ttf',
    licence: 'Inter 4.1, (c) The Inter Project Authors, SIL Open Font License 1.1',
  },
  {
    key: 'inter-semibold',
    url: INTER_ZIP,
    entry: 'extras/ttf/Inter-SemiBold.ttf',
    licence: 'Inter 4.1, (c) The Inter Project Authors, SIL Open Font License 1.1',
  },
  {
    key: 'jetbrains-mono-regular',
    url: `${JETBRAINS_MONO}/JetBrainsMono-Regular.ttf`,
    licence:
      'JetBrains Mono 2.304, (c) The JetBrains Mono Project Authors, SIL Open Font License 1.1',
  },
];

/** Every code point in [from, to], as characters. */
function span(from: number, to: number): string {
  let out = '';
  for (let cp = from; cp <= to; cp++) {
    out += String.fromCodePoint(cp);
  }
  return out;
}

/**
 * What the UI can print: ASCII and Latin-1 for text and names, plus the
 * symbols the formatters and the panels use. A glyph a font lacks is skipped
 * by the generator; uikit then draws a box and warns, which the headset check
 * looks for.
 */
export const CHARSET = [
  span(0x20, 0x7e),
  span(0xa0, 0xff),
  'μπΔ', // micro, pi, delta
  '‐–—‘’“”•…′″', // dashes, quotes, bullet, ellipsis, primes
  '⁰ⁱ⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉', // exponents and subscripts beyond Latin-1's ¹²³
  '−≈≠≤≥∞', // true minus, comparisons
  '←↑→↓↗▲▶▼◀', // arrows and transport glyphs
].join('');

/** The parts of a BMFont JSON description this stage rewrites. */
interface BMFontJson {
  chars: Array<{ id: number; index: number; char: string }>;
  kernings: Array<{ first: number; second: number }>;
  [field: string]: unknown;
}

/** Run the generator, which reports through a callback. */
async function generate(ttf: Buffer, key: string): Promise<{ png: Buffer; json: BMFontJson }> {
  return new Promise((resolve, reject) => {
    generateBMFont(
      ttf,
      {
        filename: key,
        outputType: 'json',
        fieldType: 'msdf',
        // The same glyph size and distance range as uikit's own fonts, which
        // its text shader is tuned for.
        fontSize: 44,
        distanceRange: 4,
        textureSize: [2048, 2048],
        smartSize: true,
        charset: CHARSET,
      },
      (error, textures, font) => {
        if (error) {
          reject(error);
          return;
        }
        if (textures.length !== 1) {
          reject(new Error(`${key}: expected one atlas page, got ${textures.length}`));
          return;
        }
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- the generator's own BMFont output, written a line earlier
        const json: BMFontJson = JSON.parse(font.data);
        resolve({ png: textures[0].texture, json });
      },
    );
  });
}

const exportName = (key: string): string => key.toUpperCase().replaceAll('-', '_');

/**
 * Drop the characters the font does not have. The generator fills them with
 * the font's .notdef box (glyph index 0), which would then print silently; left
 * out, uikit warns about the missing glyph instead. Spaces are glyph 0 in some
 * fonts too and are kept.
 */
function withoutMissing(json: BMFontJson): BMFontJson {
  const kept = json.chars.filter((c) => c.index !== 0 || c.char.trim() === '');
  const ids = new Set(kept.map((c) => c.id));
  return {
    ...json,
    chars: kept,
    kernings: json.kernings.filter((k) => ids.has(k.first) && ids.has(k.second)),
  };
}

/** The generated module: the BMFont JSON with the atlas inlined as its one page. */
function moduleSource(source: FontSource, json: BMFontJson, png: Buffer): string {
  const font = {
    ...withoutMissing(json),
    pages: [`data:image/png;base64,${png.toString('base64')}`],
  };
  return `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * MSDF atlas for the in-headset UI: ${source.licence}.
 * See scripts/assets/fonts.ts for the character set and settings.
 */

import type { FontFamilyWeightMap } from '@pmndrs/uikit';

export const ${exportName(source.key)}: NonNullable<FontFamilyWeightMap['normal']> = JSON.parse(${JSON.stringify(JSON.stringify(font))});
`;
}

/** The TTF for one source, from the download cache. */
async function readTtf(source: FontSource): Promise<Buffer | null> {
  const file = path.join(CACHE, 'fonts', path.basename(new URL(source.url).pathname));
  if (!(await download(source.url, file, path.basename(file)))) {
    return null;
  }
  const buf = await fs.readFile(file);
  return source.entry === undefined ? buf : unzipEntry(buf, source.entry);
}

/** Build every atlas module, adding the ones that could not be built to `failures`. */
export async function buildFonts(failures: string[]): Promise<void> {
  const outDir = path.join(GENERATED, 'fonts');
  await fs.mkdir(outDir, { recursive: true });
  for (const source of FONT_SOURCES) {
    const ttf = await readTtf(source);
    if (!ttf) {
      console.log(`  ${C.red('missing')} ${source.key}`);
      failures.push(`${source.key}.ts`);
      continue;
    }
    const { png, json } = await generate(ttf, source.key);
    const out = path.join(outDir, `${source.key}.ts`);
    await fs.writeFile(out, moduleSource(source, json, png));
    console.log(
      `  ${C.green('wrote  ')} ${path.relative(process.cwd(), out)} ${C.dim(`${(png.length / 1024).toFixed(0)} KB atlas`)}`,
    );
  }
}
