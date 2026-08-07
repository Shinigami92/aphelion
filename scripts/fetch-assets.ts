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

import { createGunzip, deflateSync } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache')
const TEXTURES = path.join(ROOT, 'public', 'textures')
const SHAPES = path.join(ROOT, 'public', 'shapes')
const GENERATED = path.join(ROOT, 'src', 'data', 'generated')
const QUEUE = path.join(CACHE, 'convert-queue.tsv')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Aphelion/1.0'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return null
  const eq = hit.indexOf('=')
  return eq === -1 ? '' : hit.slice(eq + 1)
}
const only = flag('only')
const tier = (flag('tier') ?? 'max') as 'max' | 'high' | 'lean'
const skipUsgs = flag('skip-usgs') !== null
const doTextures = only === null || only === 'textures'
const doData = only === null || only === 'data'
const doRelief = only === null || only === 'relief'
const manifestOnly = only === 'manifest'

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

const step = (msg: string): void => console.log(`\n${C.bold(`> ${msg}`)}`)
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Download to a cache path, skipping the request if it is already there. */
async function download(url: string, dest: string, label: string): Promise<boolean> {
  if (await exists(dest)) {
    const st = await fs.stat(dest)
    if (st.size > 0) {
      console.log(`  ${C.dim('cached ')} ${label} ${C.dim(mb(st.size))}`)
      return true
    }
  }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  process.stdout.write(`  ${C.cyan('fetch  ')} ${label} ... `)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      console.log(C.red(`HTTP ${res.status}`))
      return false
    }
    const ct = res.headers.get('content-type') ?? ''
    const buf = Buffer.from(await res.arrayBuffer())
    // Solar System Scope answers unknown filenames with a 200 HTML page.
    if (/text\/html/i.test(ct)) {
      console.log(C.red('got HTML, not an asset'))
      return false
    }
    await fs.writeFile(dest, buf)
    console.log(C.green(mb(buf.length)))
    return true
  } catch (err) {
    console.log(C.red(`failed: ${(err as Error).message}`))
    return false
  }
}

async function fetchText(url: string, cacheName: string, label: string): Promise<string | null> {
  const dest = path.join(CACHE, cacheName)
  if (!(await download(url, dest, label))) return null
  return fs.readFile(dest, 'utf8')
}

/** Queue an image for format conversion / downsampling by the shell helper. */
const convertQueue: string[] = []
function queueConvert(src: string, dest: string, maxDim: number): void {
  convertQueue.push(`${src}\t${dest}\t${maxDim}`)
  console.log(`  ${C.dim('queued ')} ${path.basename(dest)} ${C.dim(`<= ${path.basename(src)}`)}`)
}

// ---------------------------------------------------------------------------
// 1. Solar System Scope planetary maps  (CC BY 4.0)
// ---------------------------------------------------------------------------

interface TextureSpec {
  out: string
  /** Candidate source filenames, best first. */
  candidates: string[]
  /** Max dimension when the source needs conversion. */
  convertTo?: number
}

const SSS_BASE = 'https://www.solarsystemscope.com/textures/download/'

function sssTextures(): TextureSpec[] {
  // Solar System Scope only publishes certain bodies at certain sizes, so each
  // entry degrades gracefully from the requested tier downward.
  const big = tier === 'lean' ? ['2k'] : tier === 'high' ? ['4k', '2k'] : ['8k', '4k', '2k']
  const pick = (stem: string, sizes = big) => sizes.map((s) => `${s}_${stem}`)

  return [
    { out: 'sun.jpg', candidates: pick('sun.jpg') },
    { out: 'mercury.jpg', candidates: pick('mercury.jpg') },
    { out: 'venus_surface.jpg', candidates: pick('venus_surface.jpg') },
    { out: 'venus_atmosphere.jpg', candidates: pick('venus_atmosphere.jpg', ['4k', '2k']) },
    { out: 'earth_day.jpg', candidates: pick('earth_daymap.jpg') },
    { out: 'earth_night.jpg', candidates: pick('earth_nightmap.jpg') },
    { out: 'earth_clouds.jpg', candidates: pick('earth_clouds.jpg') },
    { out: 'earth_normal.jpg', candidates: pick('earth_normal_map.tif'), convertTo: 8192 },
    { out: 'earth_specular.jpg', candidates: pick('earth_specular_map.tif'), convertTo: 4096 },
    { out: 'moon.jpg', candidates: pick('moon.jpg') },
    { out: 'mars.jpg', candidates: pick('mars.jpg') },
    { out: 'jupiter.jpg', candidates: pick('jupiter.jpg') },
    { out: 'saturn.jpg', candidates: pick('saturn.jpg') },
    { out: 'saturn_ring.png', candidates: pick('saturn_ring_alpha.png') },
    { out: 'uranus.jpg', candidates: pick('uranus.jpg', ['2k']) },
    { out: 'neptune.jpg', candidates: pick('neptune.jpg', ['2k']) },
    { out: 'ceres.jpg', candidates: pick('ceres_fictional.jpg', ['4k', '2k']) },
    { out: 'eris.jpg', candidates: pick('eris_fictional.jpg', ['4k', '2k']) },
    { out: 'haumea.jpg', candidates: pick('haumea_fictional.jpg', ['4k', '2k']) },
    { out: 'makemake.jpg', candidates: pick('makemake_fictional.jpg', ['4k', '2k']) },
    { out: 'milkyway.jpg', candidates: pick('stars_milky_way.jpg') },
    { out: 'starfield.jpg', candidates: pick('stars.jpg') },
  ]
}

// ---------------------------------------------------------------------------
// 2. USGS Astrogeology global mosaics  (public domain)
// ---------------------------------------------------------------------------

interface UsgsSpec {
  out: string
  url: string
  maxDim: number
  note: string
}

const USGS: UsgsSpec[] = [
  {
    out: 'io.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif',
    maxDim: 4096,
    note: 'Galileo SSI + Voyager, 1 km/px',
  },
  {
    out: 'europa.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 500 m/px',
  },
  {
    out: 'ganymede.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 1 km/px',
  },
  {
    out: 'callisto.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif',
    maxDim: 4096,
    note: 'Voyager + Galileo SSI, 1 km/px',
  },
  {
    out: 'enceladus.jpg',
    url: 'https://planetarymaps.usgs.gov/mosaic/Enceladus_Cassini_mosaic_global_110m.tif',
    maxDim: 4096,
    note: 'Cassini ISS, 110 m/px',
  },
]

// ---------------------------------------------------------------------------
// 2b. USGS Astropedia  (public domain)
//
// Covers the bodies that matter most to anyone exploring and that the bulk
// mosaic bucket does not name predictably: Pluto, Charon, Phobos, Triton, the
// mid-sized Saturnians and Vesta. Before this, all of those fell back to
// procedural surfaces — which is the wrong place to economise, because they are
// exactly the worlds people go looking for.
// ---------------------------------------------------------------------------

interface AstropediaSpec {
  out: string
  /** Astropedia item id, lowercase-with-underscores. */
  id: string
  note: string
}

const ASTROPEDIA_BASE = 'https://astrogeology.usgs.gov/search/map/'

const ASTROPEDIA: AstropediaSpec[] = [
  { out: 'pluto.jpg', id: 'pluto_new_horizons_lorri_mvic_global_mosaic_300m', note: 'New Horizons LORRI+MVIC, 300 m/px' },
  { out: 'charon.jpg', id: 'charon_new_horizons_lorri_mvic_global_mosaic_300m', note: 'New Horizons LORRI+MVIC, 300 m/px' },
  { out: 'phobos.jpg', id: 'phobos_mars_express_src_global_mosaic_12m', note: 'Mars Express SRC + Viking, 12 m/px' },
  { out: 'triton.jpg', id: 'triton_voyager_2_global_color_mosaic_600m', note: 'Voyager 2 colour, 600 m/px' },
  { out: 'iapetus.jpg', id: 'iapetus_cassini_voyager_global_mosaic_803m', note: 'Cassini + Voyager, 803 m/px' },
  { out: 'dione.jpg', id: 'dione_cassini_voyager_global_mosaic_154m', note: 'Cassini + Voyager, 154 m/px' },
  { out: 'rhea.jpg', id: 'rhea_cassini_voyager_global_mosaic_417m', note: 'Cassini + Voyager, 417 m/px' },
  { out: 'tethys.jpg', id: 'tethys_cassini_global_mosaic_293m', note: 'Cassini ISS, 293 m/px' },
  { out: 'vesta.jpg', id: 'vesta_dawn_fc_hamo_global_mosaic_60m', note: 'Dawn FC HAMO, 60 m/px' },
]

/**
 * Resolve an Astropedia item to a downloadable image.
 *
 * The HTML item pages are JavaScript-rendered and carry no usable links, but
 * each one has a static FGDC metadata sibling at `<id>.xml` that contains the
 * CKAN download URL. An unknown id returns the site's ordinary 404 page — which
 * is HTML, and which carries its own footer thumbnails, so we reject on the
 * doctype and skip anything with "thumb" in the name.
 */
async function astropediaImageUrl(spec: AstropediaSpec): Promise<string | null> {
  const xml = await fetchText(
    `${ASTROPEDIA_BASE}${spec.id}.xml`,
    `astropedia-${spec.id}.xml`,
    `metadata for ${spec.out}`,
  )
  if (!xml) return null
  if (/^\s*<!DOCTYPE html/i.test(xml)) {
    console.log(`  ${C.yellow('missing')} Astropedia id not found: ${spec.id}`)
    return null
  }
  const urls = [
    ...xml.matchAll(/https:\/\/astrogeology\.usgs\.gov[^\s"'<>]+\/download\/[^\s"'<>]+/g),
  ].map((m) => m[0])
  return urls.find((u) => !/thumb/i.test(u) && /\.(jpe?g|png|tif)$/i.test(u)) ?? null
}

// ---------------------------------------------------------------------------
// 2c. Topography  (public domain)
//
// Relief comes from published global elevation grids, not from mesh files. One
// equirectangular height map serves both the near-spheres, whose relief is only
// visible once explore mode exaggerates it, and (later) the small bodies, whose
// shape models resample onto the same grid. A mesh cannot do the first job:
// exaggeration would mean re-baking geometry per level, where a height map needs
// a single uniform — and a mesh would also carry one fixed tessellation, where
// the map displaces all four of our LOD spheres.
// ---------------------------------------------------------------------------

interface ReliefSpec {
  /** Body key, matching src/data/bodies.ts. */
  body: string
  out: string
  url: string
  width: number
  height: number
  /** Metres of elevation per stored raster unit. */
  metresPerDn: number
  /**
   * Byte order of the 16-bit samples. Not a detail worth guessing: MOLA ships
   * MSB and LOLA ships LSB, and reading one as the other yields a full-range
   * grid of plausible-looking noise rather than an obvious failure.
   */
  endian: 'msb' | 'lsb'
  /** East longitude of the source raster's left-hand column, degrees. */
  originLonEast: number
  credit: string
  note: string
}

const RELIEF: ReliefSpec[] = [
  {
    body: 'mars',
    out: 'mars_relief.png',
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img',
    width: 1440,
    height: 720,
    metresPerDn: 1,
    endian: 'msb',
    originLonEast: 0,
    credit: 'MGS MOLA MEGDR — NASA/JPL/GSFC, PDS Geosciences Node',
    note: 'MOLA MEGDR, 4 px/deg',
  },
  {
    body: 'moon:Moon',
    out: 'moon_relief.png',
    url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img',
    width: 1440,
    height: 720,
    // LOLA's LDEM is a shape map: radius minus a 1737.4 km reference sphere,
    // stored at half-metre resolution. Our own lunar radius differs from that
    // reference by a few hundred metres, which is a uniform sphere-size offset
    // of 0.02% and invisible.
    metresPerDn: 0.5,
    endian: 'lsb',
    originLonEast: 0,
    credit: 'LRO LOLA LDEM — NASA/GSFC, PDS Geosciences Node',
    note: 'LOLA LDEM, 4 px/deg',
  },
]

interface ReliefResult {
  body: string
  out: string
  width: number
  height: number
  minKm: number
  maxKm: number
  credit: string
}

/**
 * Shape models, for bodies too irregular for "elevation above a datum" to mean
 * anything. Same output format as the raster grids above — an equirectangular
 * map of offsets from the body's mean radius — so the renderer needs no second
 * code path. The conversion is the whole job: these arrive as a cube of
 * vertices, not as a lat/lon grid.
 */
interface ShapeModelSpec {
  body: string
  out: string
  url: string
  width: number
  height: number
  /**
   * Radius the offsets are measured from, km. Must match the radius the app
   * gives this body, or the shape inflates or shrinks uniformly.
   */
  referenceRadiusKm: number
  credit: string
  note: string
}

const SHAPE_MODELS: ShapeModelSpec[] = [
  {
    body: 'moon:Phobos',
    out: 'phobos_relief.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/gaskell.phobos.shape-model/data/phobos_quad128q.tab',
    // The model's own spacing is ~0.12 km, which on an 11 km body is 0.63
    // degrees of arc — so 512 x 256 (0.70 deg/px) samples it about right and
    // anything finer would just interpolate.
    width: 512,
    height: 256,
    referenceRadiusKm: 11.08,
    credit: 'Gaskell Phobos shape model — PDS Small Bodies Node',
    note: 'Gaskell 128q, 6 x 129² vertices',
  },
]

// -- a minimal 8-bit RGB PNG writer -----------------------------------------
//
// No image library is a dependency here, and none is needed: an uncompressed
// truecolour PNG is a signature, three chunks and a zlib stream. Writing it by
// hand also means no encoder slips in a gAMA or iCCP chunk, which a browser
// would honour and quietly regrade — fatal when the pixels are numbers rather
// than colours.

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type 2 = truecolour RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Filter type 1 (Sub) predicts each byte from the same channel one pixel to
  // the left. Elevation is smooth horizontally, so the high byte nearly
  // vanishes; the low byte is noise and will not compress, which is the price
  // of keeping 16 bits of precision.
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const src = y * stride
    const dst = y * (stride + 1)
    raw[dst] = 1
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? rgb[src + x - 3]! : 0
      raw[dst + 1 + x] = (rgb[src + x]! - left) & 0xff
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Turn a raw 16-bit signed big-endian elevation raster into a relief PNG.
 *
 * Two deliberate transforms. The grid is rolled half a turn so its left edge is
 * 180 degrees west, matching the colour mosaics and letting relief and albedo
 * share one set of UVs — offsetting in the shader instead would need a fract()
 * that breaks derivative-based normals at the seam. And elevation is split
 * across the red (high byte) and green (low byte) channels, because browsers
 * decode 16-bit PNGs down to 8 bits, and 8 bits across Mars's 29 km range is a
 * 115 m quantum: that shows up as terraced normals long before it shows up as
 * a wrong altitude.
 */
async function buildRelief(spec: ReliefSpec): Promise<ReliefResult | null> {
  const outPath = path.join(SHAPES, spec.out)
  const cachePath = path.join(CACHE, path.basename(spec.url))
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) return null

  const raw = await fs.readFile(cachePath)
  const count = spec.width * spec.height
  if (raw.length !== count * 2) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: expected ${count * 2} bytes, got ${raw.length}`,
    )
    return null
  }

  // Roll so output column 0 sits at 180 degrees east longitude.
  const shift = Math.round((spec.width * (180 - spec.originLonEast)) / 360)
  const metres = new Float64Array(count)
  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      const src = y * spec.width + ((x + shift) % spec.width)
      const dn = spec.endian === 'msb' ? raw.readInt16BE(src * 2) : raw.readInt16LE(src * 2)
      const v = dn * spec.metresPerDn
      metres[y * spec.width + x] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  const span = max - min
  const rgb = Buffer.alloc(count * 3)
  for (let i = 0; i < count; i++) {
    const t = Math.round(((metres[i]! - min) / span) * 65535)
    rgb[i * 3] = (t >> 8) & 0xff
    rgb[i * 3 + 1] = t & 0xff
  }

  await fs.mkdir(SHAPES, { recursive: true })
  const png = encodePng(spec.width, spec.height, rgb)
  await fs.writeFile(outPath, png)
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${spec.width}x${spec.height}, ${(min / 1000).toFixed(2)}..${(max / 1000).toFixed(2)} km, ${mb(png.length)}`,
    )}`,
  )

  return {
    body: spec.body,
    out: spec.out,
    width: spec.width,
    height: spec.height,
    minKm: min / 1000,
    maxKm: max / 1000,
    credit: spec.credit,
  }
}

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
async function buildShapeModel(spec: ShapeModelSpec): Promise<ReliefResult | null> {
  const cachePath = path.join(CACHE, path.basename(spec.url))
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) return null

  const lines = (await fs.readFile(cachePath, 'utf8')).split('\n').filter((l) => l.trim().length > 0)
  const n = Number(lines[0]!.trim())
  const side = n + 1
  const perFace = side * side
  if (!Number.isFinite(n) || lines.length - 1 !== 6 * perFace) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: header says ${n}, expected ${6 * perFace} vertices, got ${lines.length - 1}`,
    )
    return null
  }

  const vx = new Float64Array(6 * perFace)
  const vy = new Float64Array(6 * perFace)
  const vz = new Float64Array(6 * perFace)
  for (let i = 0; i < 6 * perFace; i++) {
    const parts = lines[i + 1]!.trim().split(/\s+/)
    vx[i] = Number(parts[0])
    vy[i] = Number(parts[1])
    vz[i] = Number(parts[2])
  }

  // Guard the layout assumption: on a regular grid, stepping one column is a
  // short hop. A shuffled ordering would jump across the body instead.
  let longest = 0
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i + 1 < side; i++) {
        const k = f * perFace + j * side + i
        longest = Math.max(longest, Math.hypot(vx[k]! - vx[k + 1]!, vy[k]! - vy[k + 1]!, vz[k]! - vz[k + 1]!))
      }
    }
  }
  if (longest > spec.referenceRadiusKm * 0.25) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: grid neighbours up to ${longest.toFixed(2)} km apart`)
    return null
  }

  const w = spec.width
  const h = spec.height
  const radii = new Float64Array(w * h)
  const filled = new Uint8Array(w * h)

  const lonOf = (i: number) => {
    const d = (Math.atan2(vy[i]!, vx[i]!) * 180) / Math.PI
    return d < 0 ? d + 360 : d
  }
  const latOf = (i: number) => {
    const r = Math.hypot(vx[i]!, vy[i]!, vz[i]!)
    return (Math.asin(vz[i]! / r) * 180) / Math.PI
  }
  const radOf = (i: number) => Math.hypot(vx[i]!, vy[i]!, vz[i]!)

  const rasterise = (a: number, b: number, c: number): void => {
    let l0 = lonOf(a)
    let l1 = lonOf(b)
    let l2 = lonOf(c)
    // A triangle straddling the 0/360 seam looks 350 degrees wide; put all three
    // on one branch so it is a degree wide again.
    if (Math.max(l0, l1, l2) - Math.min(l0, l1, l2) > 180) {
      if (l0 < 180) l0 += 360
      if (l1 < 180) l1 += 360
      if (l2 < 180) l2 += 360
    }
    const t0 = latOf(a)
    const t1 = latOf(b)
    const t2 = latOf(c)
    const r0 = radOf(a)
    const r1 = radOf(b)
    const r2 = radOf(c)

    const det = (l1 - l0) * (t2 - t0) - (l2 - l0) * (t1 - t0)
    if (Math.abs(det) < 1e-12) return

    const x0 = Math.floor(((Math.min(l0, l1, l2) - 180) / 360) * w - 0.5)
    const x1 = Math.ceil(((Math.max(l0, l1, l2) - 180) / 360) * w - 0.5)
    const y0 = Math.max(0, Math.floor(((90 - Math.max(t0, t1, t2)) / 180) * h - 0.5))
    const y1 = Math.min(h - 1, Math.ceil(((90 - Math.min(t0, t1, t2)) / 180) * h - 0.5))

    for (let y = y0; y <= y1; y++) {
      const lat = 90 - ((y + 0.5) * 180) / h
      for (let x = x0; x <= x1; x++) {
        const lon = 180 + ((x + 0.5) * 360) / w
        const u = ((l1 - lon) * (t2 - lat) - (l2 - lon) * (t1 - lat)) / det
        const v = ((l2 - lon) * (t0 - lat) - (l0 - lon) * (t2 - lat)) / det
        const t = 1 - u - v
        if (u < -1e-9 || v < -1e-9 || t < -1e-9) continue
        const col = ((x % w) + w) % w
        radii[y * w + col] = u * r0 + v * r1 + t * r2
        filled[y * w + col] = 1
      }
    }
  }

  for (let f = 0; f < 6; f++) {
    for (let j = 0; j + 1 < side; j++) {
      for (let i = 0; i + 1 < side; i++) {
        const k = f * perFace + j * side + i
        rasterise(k, k + 1, k + side)
        rasterise(k + 1, k + side + 1, k + side)
      }
    }
  }

  // The projection is singular at the poles, so a handful of pixels there can
  // fall outside every triangle. Fill them from their filled neighbours.
  let holes = 0
  for (let pass = 0; pass < 8; pass++) {
    holes = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (filled[y * w + x]) continue
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy
            if (ny < 0 || ny >= h) continue
            const nx = ((x + dx) % w + w) % w
            if (!filled[ny * w + nx]) continue
            sum += radii[ny * w + nx]!
            count++
          }
        }
        if (count > 0) {
          radii[y * w + x] = sum / count
          filled[y * w + x] = 2
        } else holes++
      }
    }
    for (let i = 0; i < filled.length; i++) if (filled[i] === 2) filled[i] = 1
    if (holes === 0) break
  }
  if (holes > 0) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: ${holes} pixels never covered`)
    return null
  }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < radii.length; i++) {
    const v = radii[i]! - spec.referenceRadiusKm
    radii[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }

  const span = max - min
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < radii.length; i++) {
    const t = Math.round(((radii[i]! - min) / span) * 65535)
    rgb[i * 3] = (t >> 8) & 0xff
    rgb[i * 3 + 1] = t & 0xff
  }

  await fs.mkdir(SHAPES, { recursive: true })
  const png = encodePng(w, h, rgb)
  await fs.writeFile(path.join(SHAPES, spec.out), png)
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h}, ${min.toFixed(2)}..${max.toFixed(2)} km about r=${spec.referenceRadiusKm}, ${mb(png.length)}`,
    )}`,
  )

  return {
    body: spec.body,
    out: spec.out,
    width: w,
    height: h,
    minKm: min,
    maxKm: max,
    credit: spec.credit,
  }
}

async function writeReliefModule(results: ReliefResult[]): Promise<void> {
  const entries = results
    .map(
      // Keys are quoted because moons are keyed 'moon:Moon', which is not an
      // identifier.
      (r) => `  '${r.body}': {
    file: '${r.out}',
    width: ${r.width},
    height: ${r.height},
    minKm: ${r.minKm.toFixed(4)},
    maxKm: ${r.maxKm.toFixed(4)},
    credit: '${r.credit.replace(/'/g, "\\'")}',
  },`,
    )
    .join('\n')

  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Global elevation grids present in public/shapes, with the elevation range each
 * one was quantised against. A body with no entry here renders as its reference
 * ellipsoid, which is why the app still works before \`pnpm assets\` has run.
 *
 * Encoding: equirectangular, left edge 180 degrees west (matching the colour
 * mosaics), north row first. Elevation is a 16-bit fraction split across the red
 * (high byte) and green (low byte) channels:
 *
 *   km = minKm + (R * 256 + G) / 65535 * (maxKm - minKm)
 *
 * relative to the body's reference radius.
 */

export interface ReliefMap {
  file: string
  width: number
  height: number
  /** Elevation encoded by 0, km relative to the body's reference radius. */
  minKm: number
  /** Elevation encoded by 65535. */
  maxKm: number
  credit: string
}

export const RELIEF_MAPS: Readonly<Record<string, ReliefMap>> = {
${entries}
}

export const reliefFor = (key: string): ReliefMap | null => RELIEF_MAPS[key] ?? null
`
  await fs.mkdir(GENERATED, { recursive: true })
  await fs.writeFile(path.join(GENERATED, 'relief.ts'), src)
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/relief.ts ${C.dim(`(${results.length} maps)`)}`,
  )
}

// ---------------------------------------------------------------------------
// 3. JPL satellite elements + physical parameters
// ---------------------------------------------------------------------------

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&deg;/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function tableRows(html: string, tableId: string): string[][] {
  const table = new RegExp(`<table[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)</table>`).exec(html)
  if (!table) return []
  const out: string[][] = []
  for (const tr of table[1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]!))
    if (cells.length) out.push(cells)
  }
  return out
}

const num = (s: string | undefined): number | null => {
  if (!s) return null
  const t = s.trim()
  if (!t || t === '-' || t === 'n/a') return null
  const v = Number.parseFloat(t)
  return Number.isFinite(v) ? v : null
}

function gregorianToJd(year: number, month: number, day: number): number {
  let y = year
  let mo = month
  if (mo <= 2) {
    y -= 1
    mo += 12
  }
  const A = Math.floor(y / 100)
  const B = 2 - A + Math.floor(A / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + day + B - 1524.5
}

/** `2000-01-01.5` -> Julian Date (TDB). */
function epochStringToJd(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?$/.exec(s.trim())
  if (!m) return 2451545.0
  const frac = m[4] ? Number(`0.${m[4]}`) : 0
  return gregorianToJd(Number(m[1]), Number(m[2]), Number(m[3]) + frac)
}

/**
 * Mean radii (km) for satellites JPL's physical-parameters table omits — it
 * only covers the 46 moons with measured GM. These are published values for the
 * classical irregulars and shepherd moons; anything still missing gets a
 * nominal radius and is flagged `radiusEstimated` so the UI can say so.
 */
const KNOWN_RADII: Record<string, number> = {
  // Jupiter: inner group + Himalia/Ananke/Carme/Pasiphae families
  Metis: 21.5, Adrastea: 8.2, Amalthea: 83.5, Thebe: 49.3,
  Himalia: 69.8, Elara: 43, Lysithea: 18, Leda: 10, Dia: 2,
  Ananke: 14, Praxidike: 3.4, Harpalyke: 2.2, Iocaste: 2.6, Thyone: 2,
  Carme: 23, Taygete: 2.5, Chaldene: 1.9, Kalyke: 2.6, Isonoe: 1.9, Erinome: 1.6,
  Pasiphae: 30, Sinope: 19, Callirrhoe: 4.8, Megaclite: 2.7, Autonoe: 2,
  Themisto: 4, Carpo: 1.5, Valetudo: 0.5, Eupheme: 1,
  // Saturn: ring shepherds, co-orbitals, Trojans, Phoebe/Norse group
  Pan: 14.1, Daphnis: 3.8, Atlas: 15.1, Prometheus: 43.1, Pandora: 40.6,
  Epimetheus: 58.1, Janus: 89.5, Aegaeon: 0.33, Methone: 1.6, Anthe: 0.5,
  Pallene: 2.2, Telesto: 12.4, Calypso: 10.7, Polydeuces: 1.3, Helene: 17.6,
  Hyperion: 135, Phoebe: 106.5, Kiviuq: 8, Ijiraq: 6, Paaliaq: 11,
  Siarnaq: 20, Tarvos: 7.5, Albiorix: 14.3, Erriapus: 5, Ymir: 9,
  Skathi: 4, Mundilfari: 3.5, Suttungr: 3.5, Thrymr: 3.5, Narvi: 3.5,
  Bebhionn: 3, Bergelmir: 3, Bestla: 3.5, Farbauti: 2.5, Fenrir: 2,
  Fornjot: 3, Hati: 3, Hyrrokkin: 3.5, Kari: 3.5, Loge: 3,
  Skoll: 3, Surtur: 3, Jarnsaxa: 3, Greip: 3, Tarqeq: 3.5, Aegir: 3,
  // Uranus
  Cordelia: 20.1, Ophelia: 21.4, Bianca: 25.7, Cressida: 39.8, Desdemona: 32,
  Juliet: 46.8, Portia: 67.6, Rosalind: 36, Cupid: 9, Belinda: 40.3,
  Perdita: 15, Puck: 81, Mab: 12,
  Caliban: 36, Sycorax: 75, Prospero: 25, Setebos: 24, Stephano: 16,
  Trinculo: 9, Francisco: 11, Margaret: 10, Ferdinand: 10,
  // Neptune
  Naiad: 33, Thalassa: 41, Despina: 75, Galatea: 88, Larissa: 97,
  Hippocamp: 17.4, Proteus: 210, Nereid: 170, Halimede: 31, Sao: 22,
  Laomedeia: 21, Psamathe: 20, Neso: 30,
  // Pluto
  Nix: 24.8, Hydra: 30.2, Kerberos: 6, Styx: 5.2,
}

/** Nominal radius for undocumented satellites, by parent. */
const NOMINAL_RADIUS: Record<string, number> = {
  Jupiter: 1.5,
  Saturn: 2.0,
  Uranus: 5.0,
  Neptune: 20.0,
  Pluto: 5.0,
  Mars: 6.0,
  Earth: 1000,
}

interface SatelliteRecord {
  name: string
  code: number
  planet: string
  frame: 'ecliptic' | 'equatorial' | 'laplace'
  epoch: number
  a: number
  e: number
  argPeri: number
  m0: number
  inc: number
  node: number
  period: number
  apsisPeriod: number | null
  nodePeriod: number | null
  poleRa: number | null
  poleDec: number | null
  radius: number
  radiusEstimated: boolean
  gm: number | null
  density: number | null
}

async function buildSatelliteData(): Promise<SatelliteRecord[] | null> {
  const elemHtml = await fetchText(
    'https://ssd.jpl.nasa.gov/sats/elem/',
    'sats_elem.html',
    'JPL satellite mean elements',
  )
  const physHtml = await fetchText(
    'https://ssd.jpl.nasa.gov/sats/phys_par/',
    'sats_phys.html',
    'JPL satellite physical parameters',
  )
  if (!elemHtml) return null

  // Physical parameters keyed by NAIF code. Each measurement cell reads
  // "value sigma reference", so the first token is the number we want.
  const phys = new Map<number, { gm: number | null; radius: number | null; density: number | null }>()
  if (physHtml) {
    const firstToken = (s: string | undefined) => num(s?.trim().split(/\s+/)[0])
    for (const row of tableRows(physHtml, 'sat_phys_par')) {
      const code = num(row[2])
      if (code === null) continue
      phys.set(code, { gm: firstToken(row[3]), radius: firstToken(row[4]), density: firstToken(row[5]) })
    }
  }

  const records: SatelliteRecord[] = []
  const seen = new Set<number>()

  for (const row of tableRows(elemHtml, 'sat_elem')) {
    // ID Planet Satellite Code Ephemeris Frame Epoch a e w M i node P Papsis Pnode RA Dec Tilt Ref
    const planet = row[1] ?? ''
    const name = row[2] ?? ''
    const code = num(row[3])
    const frameRaw = (row[5] ?? '').toLowerCase()
    const a = num(row[7])
    const e = num(row[8])
    const period = num(row[13])

    if (code === null || !name || a === null || e === null || period === null) continue
    // The table lists several ephemeris solutions per moon; JPL orders them
    // best-first, so keep the first and drop duplicates.
    if (seen.has(code)) continue
    seen.add(code)

    const frame: SatelliteRecord['frame'] = frameRaw.includes('laplace')
      ? 'laplace'
      : frameRaw.includes('equator')
        ? 'equatorial'
        : 'ecliptic'

    const p = phys.get(code)
    const published = p?.radius ?? KNOWN_RADII[name] ?? null

    records.push({
      name,
      code,
      planet,
      frame,
      epoch: epochStringToJd(row[6] ?? '2000-01-01.5'),
      a,
      e,
      argPeri: num(row[9]) ?? 0,
      m0: num(row[10]) ?? 0,
      inc: num(row[11]) ?? 0,
      node: num(row[12]) ?? 0,
      period,
      apsisPeriod: num(row[14]),
      nodePeriod: num(row[15]),
      poleRa: num(row[16]),
      poleDec: num(row[17]),
      radius: published ?? NOMINAL_RADIUS[planet] ?? 2,
      radiusEstimated: published === null,
      gm: p?.gm ?? null,
      density: p?.density ?? null,
    })
  }
  return records
}

// ---------------------------------------------------------------------------
// 4. Minor Planet Center orbit catalogues
// ---------------------------------------------------------------------------

const PACK_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUV'

/** MPC packed epoch, e.g. `K2669` -> Julian Date. */
function unpackEpoch(packed: string): number {
  if (packed.length < 5) return 2451545.0
  const c = packed[0]!
  const century = c === 'I' ? 18 : c === 'J' ? 19 : 20
  const year = century * 100 + Number(packed.slice(1, 3))
  const month = PACK_CHARS.indexOf(packed[3]!)
  const day = PACK_CHARS.indexOf(packed[4]!)
  if (month < 1 || day < 1 || !Number.isFinite(year)) return 2451545.0
  return gregorianToJd(year, month, day)
}

interface SmallBody {
  name: string
  h: number
  a: number
  e: number
  inc: number
  node: number
  argPeri: number
  m0: number
  epoch: number
  group: string
}

/**
 * Classify by semi-major axis and eccentricity. These are the dynamical
 * families the belts are actually made of, and the renderer colours both the
 * catalogued bodies and the background swarms by them.
 */
function classify(a: number, e: number): string {
  const q = a * (1 - e)
  if (a < 2.0) return q < 1.3 ? 'near-earth' : 'inner-belt'
  if (a < 2.5) return 'inner-belt'
  if (a < 2.82) return 'mid-belt'
  if (a < 3.28) return 'outer-belt'
  if (a < 3.7) return 'cybele'
  if (a < 4.6) return 'hilda'
  if (a < 5.5) return 'jupiter-trojan'
  if (a < 30.1) return 'centaur'
  if (a < 39.4) return 'plutino'
  if (a < 48) return e > 0.24 ? 'scattered' : 'classical-kbo'
  if (a < 100) return 'scattered'
  return 'detached'
}

function parseMpcLine(line: string): SmallBody | null {
  if (line.length < 103) return null
  const h = Number.parseFloat(line.slice(8, 13))
  const m0 = Number.parseFloat(line.slice(26, 35))
  const argPeri = Number.parseFloat(line.slice(37, 46))
  const node = Number.parseFloat(line.slice(48, 57))
  const inc = Number.parseFloat(line.slice(59, 68))
  const e = Number.parseFloat(line.slice(69, 79))
  const a = Number.parseFloat(line.slice(92, 103))

  if (![m0, argPeri, node, inc, e, a].every(Number.isFinite)) return null
  if (a <= 0 || e < 0 || e >= 1) return null

  // Readable designation sits in a fixed field near the end of the record.
  let name = line.slice(166, 194).trim()
  if (!name) name = line.slice(0, 7).trim()
  // "(1) Ceres" -> "Ceres"; bare provisional designations keep their form.
  const paren = /^\((\d+)\)\s*(.*)$/.exec(name)
  if (paren) name = paren[2]!.trim() || `(${paren[1]})`

  return {
    name,
    h: Number.isFinite(h) ? h : 99,
    a,
    e,
    inc,
    node,
    argPeri,
    m0,
    epoch: unpackEpoch(line.slice(20, 25)),
    group: classify(a, e),
  }
}

/** Keep the brightest (hence largest) N per dynamical family. */
function topPerGroup(bodies: SmallBody[], quotas: Record<string, number>): SmallBody[] {
  const byGroup = new Map<string, SmallBody[]>()
  for (const b of bodies) {
    const list = byGroup.get(b.group)
    if (list) list.push(b)
    else byGroup.set(b.group, [b])
  }
  const out: SmallBody[] = []
  for (const [group, list] of byGroup) {
    const quota = quotas[group] ?? 0
    if (quota <= 0) continue
    list.sort((x, y) => x.h - y.h)
    out.push(...list.slice(0, quota))
  }
  out.sort((x, y) => x.h - y.h)
  return out
}

async function buildSmallBodyData(): Promise<SmallBody[] | null> {
  const distantPath = path.join(CACHE, 'Distant.txt')
  const mpcorbPath = path.join(CACHE, 'MPCORB.DAT.gz')

  const gotDistant = await download(
    'https://www.minorplanetcenter.net/iau/MPCORB/Distant.txt',
    distantPath,
    'MPC Distant.txt (TNOs, Centaurs)',
  )
  const gotMpcorb = await download(
    'https://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz',
    mpcorbPath,
    'MPC MPCORB.DAT.gz (main belt)',
  )
  if (!gotDistant && !gotMpcorb) return null

  const all: SmallBody[] = []

  if (gotDistant) {
    const text = await fs.readFile(distantPath, 'utf8')
    for (const line of text.split('\n')) {
      const b = parseMpcLine(line)
      if (b) all.push(b)
    }
    console.log(`  ${C.dim('parsed ')} ${all.length} distant objects`)
  }

  if (gotMpcorb) {
    const before = all.length
    // ~315 MB decompressed, 1.5 M records: stream it and keep only the bright
    // end, which is all we render individually.
    const rl = createInterface({
      input: createReadStream(mpcorbPath).pipe(createGunzip()),
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      const b = parseMpcLine(line)
      if (b && b.h <= 11.5) all.push(b)
    }
    console.log(`  ${C.dim('parsed ')} ${all.length - before} bright MPCORB objects`)
  }

  // Distant.txt and MPCORB overlap on the TNOs; keep the brighter entry.
  const byName = new Map<string, SmallBody>()
  for (const b of all) {
    const prev = byName.get(b.name)
    if (!prev || b.h < prev.h) byName.set(b.name, b)
  }

  return topPerGroup([...byName.values()], {
    'near-earth': 6,
    'inner-belt': 22,
    'mid-belt': 30,
    'outer-belt': 30,
    cybele: 10,
    hilda: 8,
    'jupiter-trojan': 24,
    centaur: 16,
    plutino: 22,
    'classical-kbo': 26,
    scattered: 22,
    detached: 10,
  })
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const r6 = (n: number): string => {
  const v = Number(n.toFixed(6))
  return Object.is(v, -0) ? '0' : String(v)
}
const orNull = (n: number | null): string => (n === null ? 'null' : r6(n))

async function writeSatelliteModule(records: SatelliteRecord[]): Promise<void> {
  const byPlanet = new Map<string, number>()
  for (const r of records) byPlanet.set(r.planet, (byPlanet.get(r.planet) ?? 0) + 1)
  const summary = [...byPlanet.entries()].map(([p, n]) => `${p} ${n}`).join(', ')
  const estimated = records.filter((r) => r.radiusEstimated).length

  const lines = records.map((r) => {
    const fields = [
      `name: ${JSON.stringify(r.name)}`,
      `code: ${r.code}`,
      `planet: ${JSON.stringify(r.planet.toLowerCase())}`,
      `frame: ${JSON.stringify(r.frame)}`,
      `epoch: ${r6(r.epoch)}`,
      `a: ${r6(r.a)}`,
      `e: ${r6(r.e)}`,
      `argPeri: ${r6(r.argPeri)}`,
      `m0: ${r6(r.m0)}`,
      `inc: ${r6(r.inc)}`,
      `node: ${r6(r.node)}`,
      `period: ${r6(r.period)}`,
      `apsisPeriod: ${orNull(r.apsisPeriod)}`,
      `nodePeriod: ${orNull(r.nodePeriod)}`,
      `poleRa: ${orNull(r.poleRa)}`,
      `poleDec: ${orNull(r.poleDec)}`,
      `radius: ${r6(r.radius)}`,
      `radiusEstimated: ${r.radiusEstimated}`,
      `gm: ${orNull(r.gm)}`,
      `density: ${orNull(r.density)}`,
    ]
    return `  { ${fields.join(', ')} },`
  })

  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Satellite mean orbital elements and physical parameters from JPL Solar System
 * Dynamics (https://ssd.jpl.nasa.gov/sats/elem/ and .../phys_par/).
 *
 * ${records.length} satellites: ${summary}.
 * ${estimated} have no published radius and use a nominal size
 * (\`radiusEstimated: true\`).
 *
 * Angles are degrees, distances kilometres, periods days (orbital) or years
 * (apsidal/nodal precession). \`frame\` selects the plane the angles refer to;
 * \`poleRa\`/\`poleDec\` define the Laplace plane where applicable.
 */

export interface SatelliteData {
  name: string
  /** NAIF/JPL body code. */
  code: number
  /** Lowercase parent planet key. */
  planet: string
  frame: 'ecliptic' | 'equatorial' | 'laplace'
  /** Epoch of the elements, Julian Date (TDB). */
  epoch: number
  /** Semi-major axis, km. */
  a: number
  e: number
  /** Argument of periapsis, degrees. */
  argPeri: number
  /** Mean anomaly at epoch, degrees. */
  m0: number
  /** Inclination to the reference plane, degrees. */
  inc: number
  /** Longitude of ascending node, degrees. */
  node: number
  /** Sidereal period, days. */
  period: number
  /** Apsidal precession period, years. */
  apsisPeriod: number | null
  /** Nodal regression period, years. */
  nodePeriod: number | null
  /** Laplace-plane pole right ascension, degrees. */
  poleRa: number | null
  /** Laplace-plane pole declination, degrees. */
  poleDec: number | null
  /** Mean radius, km. */
  radius: number
  radiusEstimated: boolean
  /** GM, km^3/s^2. */
  gm: number | null
  /** Mean density, g/cm^3. */
  density: number | null
}

export const SATELLITES: readonly SatelliteData[] = [
${lines.join('\n')}
]
`
  await fs.mkdir(GENERATED, { recursive: true })
  await fs.writeFile(path.join(GENERATED, 'satellites.ts'), src)
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/satellites.ts ${C.dim(`(${records.length} moons, ${estimated} estimated radii)`)}`,
  )
}

async function writeSmallBodyModule(bodies: SmallBody[]): Promise<void> {
  const byGroup = new Map<string, number>()
  for (const b of bodies) byGroup.set(b.group, (byGroup.get(b.group) ?? 0) + 1)
  const summary = [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(', ')

  const lines = bodies.map(
    (b) =>
      `  { name: ${JSON.stringify(b.name)}, h: ${r6(b.h)}, a: ${r6(b.a)}, e: ${r6(b.e)}, inc: ${r6(
        b.inc,
      )}, node: ${r6(b.node)}, argPeri: ${r6(b.argPeri)}, m0: ${r6(b.m0)}, epoch: ${r6(
        b.epoch,
      )}, group: ${JSON.stringify(b.group)} },`,
  )

  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Osculating orbital elements for the largest minor planets, from the IAU Minor
 * Planet Center orbit catalogues (MPCORB.DAT and Distant.txt).
 *
 * ${bodies.length} bodies: ${summary}.
 *
 * Selection is the brightest (hence largest) objects per dynamical family, so
 * every dwarf planet and every major belt / Trojan / Kuiper population is
 * present with its real orbit. The dense background swarms are generated
 * statistically at runtime -- see src/data/belts.ts.
 *
 * Angles are degrees, semi-major axis AU, epoch Julian Date.
 */

export interface SmallBodyData {
  name: string
  /** Absolute magnitude -- the size proxy used for the render radius. */
  h: number
  /** Semi-major axis, AU. */
  a: number
  e: number
  /** Inclination to the ecliptic, degrees. */
  inc: number
  /** Longitude of ascending node, degrees. */
  node: number
  /** Argument of perihelion, degrees. */
  argPeri: number
  /** Mean anomaly at epoch, degrees. */
  m0: number
  epoch: number
  group: string
}

export const SMALL_BODIES: readonly SmallBodyData[] = [
${lines.join('\n')}
]
`
  await fs.mkdir(GENERATED, { recursive: true })
  await fs.writeFile(path.join(GENERATED, 'smallbodies.ts'), src)
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/smallbodies.ts ${C.dim(`(${bodies.length} bodies)`)}`,
  )
}

/** Lets the app know which textures actually made it onto disk. */
async function writeManifest(): Promise<void> {
  let names: string[] = []
  try {
    names = (await fs.readdir(TEXTURES)).filter((f) => /\.(jpg|png|webp)$/i.test(f)).sort()
  } catch {
    names = []
  }
  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Textures present in public/textures. Anything absent falls back to the
 * procedural generator in src/render/procedural.ts, which is why the app still
 * runs -- and still looks right -- before \`pnpm assets\` has been run.
 */

export const AVAILABLE_TEXTURES: ReadonlySet<string> = new Set(${JSON.stringify(names, null, 2)})

export const hasTexture = (file: string): boolean => AVAILABLE_TEXTURES.has(file)
`
  await fs.mkdir(GENERATED, { recursive: true })
  await fs.writeFile(path.join(GENERATED, 'textures.ts'), src)
  console.log(`  ${C.green('wrote  ')} src/data/generated/textures.ts ${C.dim(`(${names.length} textures)`)}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(C.bold('\nAphelion asset pipeline'))

  await fs.mkdir(CACHE, { recursive: true })
  await fs.mkdir(TEXTURES, { recursive: true })

  if (manifestOnly) {
    step('Texture manifest')
    await writeManifest()
    console.log('')
    return
  }

  console.log(C.dim(`tier=${tier}  usgs=${skipUsgs ? 'skipped' : 'on'}`))
  const failures: string[] = []

  if (doTextures) {
    step('Solar System Scope planetary maps (CC BY 4.0)')
    for (const spec of sssTextures()) {
      const outPath = path.join(TEXTURES, spec.out)
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`)
        continue
      }
      let done = false
      for (const cand of spec.candidates) {
        const cachePath = path.join(CACHE, cand)
        if (!(await download(SSS_BASE + cand, cachePath, cand))) continue
        if (/\.tif$/i.test(cand)) {
          queueConvert(cachePath, outPath, spec.convertTo ?? 4096)
        } else {
          await fs.copyFile(cachePath, outPath)
        }
        done = true
        break
      }
      if (!done) failures.push(spec.out)
    }

    if (!skipUsgs) {
      step('USGS Astrogeology global mosaics (public domain)')
      console.log(C.dim('  large source GeoTIFFs, downsampled to 4k during conversion'))
      for (const spec of USGS) {
        const outPath = path.join(TEXTURES, spec.out)
        if (await exists(outPath)) {
          console.log(`  ${C.dim('have   ')} ${spec.out}`)
          continue
        }
        const cachePath = path.join(CACHE, path.basename(spec.url))
        if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
          failures.push(spec.out)
          continue
        }
        queueConvert(cachePath, outPath, spec.maxDim)
      }
    } else {
      step('USGS mosaics -- skipped (--skip-usgs)')
    }

    step('USGS Astropedia mosaics (public domain)')
    for (const spec of ASTROPEDIA) {
      const outPath = path.join(TEXTURES, spec.out)
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`)
        continue
      }
      const url = await astropediaImageUrl(spec)
      if (!url) {
        failures.push(spec.out)
        continue
      }
      const cachePath = path.join(CACHE, `astropedia-${spec.out}`)
      if (!(await download(url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
        failures.push(spec.out)
        continue
      }
      // These arrive as browse JPEGs at sane sizes, so no conversion is needed.
      await fs.copyFile(cachePath, outPath)
    }
  }

  if (doRelief) {
    step('Global topography (public domain)')
    const relief: ReliefResult[] = []
    for (const spec of RELIEF) {
      const result = await buildRelief(spec)
      if (result) relief.push(result)
      else failures.push(spec.out)
    }
    for (const spec of SHAPE_MODELS) {
      const result = await buildShapeModel(spec)
      if (result) relief.push(result)
      else failures.push(spec.out)
    }
    // Rewrite only on a complete run: the module mirrors the tables exactly, so
    // publishing a partial set would silently drop maps that are still on disk.
    if (relief.length === RELIEF.length + SHAPE_MODELS.length) await writeReliefModule(relief)
    else console.log(C.yellow('  incomplete; existing relief module left in place'))
  }

  if (doData) {
    step('JPL satellite ephemerides')
    const sats = await buildSatelliteData()
    if (sats && sats.length) await writeSatelliteModule(sats)
    else {
      console.log(C.yellow('  could not build satellite data; existing module left in place'))
      failures.push('satellites.ts')
    }

    step('Minor Planet Center orbit catalogues')
    const bodies = await buildSmallBodyData()
    if (bodies && bodies.length) await writeSmallBodyModule(bodies)
    else {
      console.log(C.yellow('  could not build small-body data; existing module left in place'))
      failures.push('smallbodies.ts')
    }
  }

  await fs.writeFile(QUEUE, convertQueue.length ? `${convertQueue.join('\n')}\n` : '')

  step('Texture manifest')
  await writeManifest()

  console.log('')
  if (convertQueue.length) {
    console.log(
      C.yellow(`${convertQueue.length} image(s) need conversion — run scripts/convert-textures.sh`),
    )
    console.log(C.dim('(`pnpm assets` does this for you; re-run the manifest step afterwards)'))
  }
  if (failures.length) {
    console.log(C.yellow(`Missing asset(s): ${failures.join(', ')}`))
    console.log(C.dim('Missing textures fall back to procedural generation at runtime.'))
  } else if (!convertQueue.length) {
    console.log(C.green('All assets present.'))
  }
  console.log('')
}

main().catch((err) => {
  console.error(C.red(`\nfetch-assets failed: ${(err as Error).stack ?? err}`))
  process.exit(1)
})
