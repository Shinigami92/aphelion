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

import { createGunzip, deflateSync, gunzipSync, inflateRawSync } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache')
const TEXTURES = path.join(ROOT, 'public', 'textures')
const SHAPES = path.join(ROOT, 'public', 'shapes')
const SKY = path.join(ROOT, 'public', 'sky')
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

/**
 * Queue an image for format conversion / downsampling by the shell helper.
 *
 * `roll` shifts a map whose left edge is not 180 west; `flop` mirrors one whose
 * longitude runs the other way (the SVS sky maps, where RA increases to the
 * left). Both are applied at build time rather than in a shader, so every
 * equirectangular image in public/ shares one convention.
 */
const convertQueue: string[] = []
function queueConvert(src: string, dest: string, maxDim: number, roll = '', flop = false): void {
  // Both go in one comma-separated field rather than a column each. `read`
  // treats tab as whitespace, and whitespace in IFS collapses runs of it into a
  // single separator -- so an empty `roll` column would silently shift `flop`
  // one place left and the image would come out un-mirrored, which is a thing
  // you can only detect by measuring the sky it produces.
  const ops = [roll ? `roll:${roll}` : '', flop ? 'flop' : ''].filter(Boolean).join(',')
  convertQueue.push(`${src}\t${dest}\t${maxDim}\t${ops}`)
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
  ]
}

// ---------------------------------------------------------------------------
// 1b. NASA SVS Deep Star Maps 2020 -- the sky background  (public domain)
//
// `milkyway_2020` is the deep sky with the Hipparcos and Tycho stars taken back
// out: 1.7 billion Gaia DR2 sources too faint to resolve, which is precisely
// what the Milky Way *is*. Aphelion draws the bright stars itself from the
// Hipparcos catalogue below, so the two layers reassemble the sky the same way
// NASA split it, and no star is drawn twice.
//
// Three facts about this product decide the whole conversion, and all three are
// stated on the SVS page rather than guessed:
//
//   - It is a plate carree in **celestial (ICRF/J2000) coordinates**, so the
//     sphere carrying it has to be rotated into Aphelion's ecliptic frame.
//   - It is centred on RA 0h with **right ascension increasing to the LEFT**,
//     which is a mirror image of every planetary map here. Flopping it at build
//     time (as the `dd360` basemaps are rolled at build time) makes u = 0.5 land
//     on RA 0 with RA increasing east, and leaves the shader with nothing to
//     know about the convention.
//   - It is linear-light OpenEXR, so the conversion has to declare the source
//     linear and let the sRGB transfer do the encoding. Skipping that step
//     crushes a mean pixel from 15/255 to 1.6/255 -- a black sky that still
//     looks like a plausible one.
// ---------------------------------------------------------------------------

const SVS_BASE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/'

interface SkySpec {
  out: string
  source: string
  maxDim: number
  note: string
}

function skyTextures(): SkySpec[] {
  const size = tier === 'lean' ? '4k' : '8k'
  const maxDim = tier === 'lean' ? 4096 : 8192
  return [
    {
      out: 'sky_milkyway.jpg',
      source: `milkyway_2020_${size}.exr`,
      maxDim,
      note: 'Gaia DR2 deep sky, Hipparcos/Tycho stars removed',
    },
  ]
}

// ---------------------------------------------------------------------------
// 2. USGS Astrogeology global mosaics  (public domain)
// ---------------------------------------------------------------------------

interface UsgsSpec {
  out: string
  url: string
  maxDim: number
  /**
   * Horizontal shift to apply, e.g. '50%'. The mosaics run -180..180 and need
   * none; the WMS basemaps are named `dd360` and start at the prime meridian,
   * so they need half a turn to sit in the same frame as everything else.
   */
  roll?: string
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
  // Titan comes from the same basemap bucket but needs neither of the two
  // adjustments Mimas and Phoebe do: it is a single-page TIFF, and `clon0` means
  // it is already centred on longitude 0 with its left edge at 180, which is
  // this project's convention. Its PDS3 label agrees — centre longitude 180 W
  // with the left edge at the prime meridian, half a turn from this file — so
  // two independent statements say the same thing and neither was assumed.
  //
  // What it shows is the surface *through* the haze: ISS's 938 nm methane window
  // is the only way Titan's ground was ever imaged from orbit. In visible light
  // Titan is a featureless orange ball, which is what the atmosphere shell over
  // this map renders.
  {
    out: 'titan.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Titan/Cassini/Titan_ISS_P19658_Mosaic_Global_4km_clon0.tif',
    maxDim: 4096,
    note: 'Cassini ISS 938 nm, 4 km/px',
  },
  // Mimas and Phoebe are absent from the mosaic set and from Astropedia, but the
  // Cassini Imaging Team basemaps behind the USGS map viewer cover both. They
  // are 8 px/deg pyramidal GeoTIFFs starting at longitude 0, hence the roll.
  {
    out: 'mimas.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Mimas/Cassini/Mimas_PDS_8ppd_dd360.tif',
    maxDim: 2048,
    roll: '50%',
    note: 'Cassini ISS, 8 px/deg',
  },
  {
    out: 'phoebe.jpg',
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/wms_basemaps/Saturn/Phoebe/Cassini/Phoebe_PDS_8ppd_dd360.tif',
    maxDim: 2048,
    roll: '50%',
    note: 'Cassini ISS, 8 px/deg',
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
  { out: 'eros.jpg', id: 'near_msi_albedo_mosaics', note: 'NEAR MSI albedo mosaic, 1024 px' },
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
  /**
   * Name fragment of the entry to pull out, when the download is a zip. Only
   * stored/deflated entries without data descriptors, which is what these
   * archives use.
   */
  zipEntry?: string
  /**
   * True when samples sit on cell *corners* rather than centres, so the grid
   * includes both poles and repeats the 180 degree meridian. ETOPO does this;
   * the PDS products do not.
   */
  gridRegistered?: boolean
  /** Output grid, when it should differ from the source. Block-averaged. */
  outWidth?: number
  outHeight?: number
  /**
   * Clamp elevations below this, in metres. Earth needs it at 0: the visible
   * surface over an ocean is the water, not the sea bed, and displacing
   * bathymetry would carve a trench through the blue.
   */
  floorMetres?: number
  credit: string
  note: string
}

/**
 * Pull one entry out of a zip.
 *
 * Node ships no zip reader, but these archives are the simple case — a few
 * deflated entries with their sizes in the local headers — so walking them is
 * shorter than taking on a dependency or shelling out to `unzip`.
 */
function unzipEntry(buf: Buffer, nameFragment: string): Buffer | null {
  let pos = 0
  while (pos + 30 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const flags = buf.readUInt16LE(pos + 6)
    const method = buf.readUInt16LE(pos + 8)
    const csize = buf.readUInt32LE(pos + 18)
    const nameLen = buf.readUInt16LE(pos + 26)
    const extraLen = buf.readUInt16LE(pos + 28)
    const name = buf.toString('ascii', pos + 30, pos + 30 + nameLen)
    const start = pos + 30 + nameLen + extraLen
    // Bit 3 puts the sizes after the data instead, which would mean scanning for
    // the descriptor; these archives do not use it, so refuse rather than guess.
    if (flags & 0x08) return null
    if (name.includes(nameFragment)) {
      const data = buf.subarray(start, start + csize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      return null
    }
    pos = start + csize
  }
  return null
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
  {
    body: 'earth',
    out: 'earth_relief.png',
    url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2/ETOPO2v2-2006/ETOPO2v2g/raw_binary/ETOPO2v2g_i2_LSB.zip',
    zipEntry: '.bin',
    // Straight from the archive's own .hdr rather than assumed: 10801 x 5401,
    // corner-registered from 180W/90N, little-endian metres.
    width: 10801,
    height: 5401,
    metresPerDn: 1,
    endian: 'lsb',
    originLonEast: 180,
    gridRegistered: true,
    outWidth: 2048,
    outHeight: 1024,
    // Sea level. Earth is the only body here whose visible surface is not its
    // solid surface over most of its area.
    floorMetres: 0,
    credit: 'ETOPO2v2 — NOAA National Centers for Environmental Information',
    note: 'ETOPO2v2, 2 arc-min, land only',
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
  /**
   * How the model is laid out. `cube-quad` is Gaskell's six-face vertex cube;
   * `lat-lon-table` is Thomas's plain latitude/longitude/radius text, which is
   * already the shape this pipeline wants and needs only resampling.
   */
  format: 'cube-quad' | 'lat-lon-table'
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

function encodePng(width: number, height: number, rgb: Buffer, channels = 3): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 1 ? 0 : 2 // colour type: 0 = greyscale, 2 = truecolour
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Filter type 1 (Sub) predicts each byte from the same channel one pixel to
  // the left. Elevation is smooth horizontally, so the high byte nearly
  // vanishes; the low byte is noise and will not compress, which is the price
  // of keeping 16 bits of precision.
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const src = y * stride
    const dst = y * (stride + 1)
    raw[dst] = 1
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rgb[src + x - channels]! : 0
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

  // Widened because inflateRawSync's buffer is not the same flavour readFile's
  // is, and the two have to share this variable.
  let raw: Buffer<ArrayBufferLike> = await fs.readFile(cachePath)
  if (spec.zipEntry) {
    const entry = unzipEntry(raw, spec.zipEntry)
    if (!entry) {
      console.log(`  ${C.red('bad    ')} ${spec.out}: no usable zip entry matching ${spec.zipEntry}`)
      return null
    }
    raw = entry
  }

  const srcCount = spec.width * spec.height
  if (raw.length !== srcCount * 2) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: expected ${srcCount * 2} bytes, got ${raw.length}`)
    return null
  }

  const w = spec.outWidth ?? spec.width
  const h = spec.outHeight ?? spec.height

  // Where each source sample actually sits. Corner-registered grids repeat the
  // 180 degree meridian and include both poles, so their spacing is one cell
  // wider than a centre-registered grid of the same column count.
  const lonOfCol = spec.gridRegistered
    ? (c: number) => spec.originLonEast + (c * 360) / (spec.width - 1)
    : (c: number) => spec.originLonEast + ((c + 0.5) * 360) / spec.width
  const latOfRow = spec.gridRegistered
    ? (r: number) => 90 - (r * 180) / (spec.height - 1)
    : (r: number) => 90 - ((r + 0.5) * 180) / spec.height

  // Scatter every source sample into the output cell it falls in and average.
  // For a same-size grid this reduces to a pure roll — one sample per cell — so
  // the products that need no resampling are untouched by the machinery.
  const sum = new Float64Array(w * h)
  const hits = new Uint32Array(w * h)
  for (let r = 0; r < spec.height; r++) {
    const lat = latOfRow(r)
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)))
    for (let c = 0; c < spec.width; c++) {
      const i = r * spec.width + c
      const dn = spec.endian === 'msb' ? raw.readInt16BE(i * 2) : raw.readInt16LE(i * 2)
      if (dn === -32768) continue // NODATA
      let v = dn * spec.metresPerDn
      // Clamped before averaging, so a coastal cell blends land down to the
      // waterline rather than being dragged below it by the sea bed offshore.
      if (spec.floorMetres !== undefined) v = Math.max(v, spec.floorMetres)
      const lon = lonOfCol(c)
      const u = ((((lon - 180) / 360) % 1) + 1) % 1
      const x = Math.min(w - 1, Math.floor(u * w))
      sum[y * w + x]! += v
      hits[y * w + x]!++
    }
  }

  let empty = 0
  let min = Infinity
  let max = -Infinity
  const metres = new Float64Array(w * h)
  for (let i = 0; i < metres.length; i++) {
    if (hits[i] === 0) {
      empty++
      continue
    }
    const v = sum[i]! / hits[i]!
    metres[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  if (empty > 0) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: ${empty} output cells received no samples`)
    return null
  }

  const span = max - min
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < metres.length; i++) {
    const t = Math.round(((metres[i]! - min) / span) * 65535)
    rgb[i * 3] = (t >> 8) & 0xff
    rgb[i * 3 + 1] = t & 0xff
  }

  await fs.mkdir(SHAPES, { recursive: true })
  const png = encodePng(w, h, rgb)
  await fs.writeFile(outPath, png)
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h}, ${(min / 1000).toFixed(2)}..${(max / 1000).toFixed(2)} km, ${mb(png.length)}`,
    )}`,
  )

  return {
    body: spec.body,
    out: spec.out,
    width: w,
    height: h,
    minKm: min / 1000,
    maxKm: max / 1000,
    credit: spec.credit,
  }
}

// ---------------------------------------------------------------------------
// 2c-b. PDS3 elevation grids inside a remote archive  (public domain)
//
// Titan's topography is the one grid here that is neither a single raster
// download nor a shape model. The Cassini RADAR team's GTDR ships as a 256 MB
// zip of 235 files — twenty-odd competing shape models at two resolutions —
// of which Aphelion wants two hemispheres totalling under a megabyte. So this
// path reads the archive over HTTP range requests instead of downloading it,
// and takes every projection parameter from each file's own attached PDS3
// label rather than from anything asserted here. That matters more than usual:
// the two hemispheres carry *different* SAMPLE_PROJECTION_OFFSETs, and the
// product is in west longitude where every other map in this project is in
// east, so a hard-coded layout would have half a chance of being mirrored and
// no way to notice.
// ---------------------------------------------------------------------------

/** A single HTTP range request. Returns null unless the server honours it. */
async function fetchRange(url: string, range: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${range}` } })
    // 200 means the server ignored the range and is sending the whole file;
    // reading that as if it were the requested slice is how you get a plausible
    // but wrong parse, so refuse it and let the caller fall back.
    if (res.status !== 206) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Pull named entries out of a zip without downloading the whole archive.
 *
 * Walks the same structures `unzipEntry` does, only over the network: the end
 * of the central directory (in the last 64 KB), the directory itself, then each
 * wanted entry's local header and payload. Anything unexpected — no ranges, a
 * zip64 directory, a name that is not there — returns null, and the caller
 * falls back to fetching the archive in full.
 */
async function fetchZipEntries(
  url: string,
  names: string[],
): Promise<Map<string, Buffer> | null> {
  const tail = await fetchRange(url, '-65536')
  if (!tail) return null

  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > tail.length) return null
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  // Zip64 parks 0xffffffff here and puts the real values in a separate record.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) return null

  const cd = await fetchRange(url, `${cdOffset}-${cdOffset + cdSize - 1}`)
  if (!cd || cd.length !== cdSize) return null

  const found = new Map<string, Buffer>()
  let pos = 0
  while (pos + 46 <= cd.length && cd.readUInt32LE(pos) === 0x02014b50) {
    const csize = cd.readUInt32LE(pos + 20)
    const nameLen = cd.readUInt16LE(pos + 28)
    const extraLen = cd.readUInt16LE(pos + 30)
    const commentLen = cd.readUInt16LE(pos + 32)
    const localOffset = cd.readUInt32LE(pos + 42)
    const name = cd.toString('ascii', pos + 46, pos + 46 + nameLen)
    const wanted = names.find((n) => name.includes(n))
    if (wanted && !found.has(wanted)) {
      // The local header repeats the name and may carry a different extra field
      // than the central one, so over-fetch and let unzipEntry read the real
      // lengths out of the header it finds at byte 0.
      const slack = 1024
      const raw = await fetchRange(url, `${localOffset}-${localOffset + csize + slack - 1}`)
      // A range clipped at end-of-file would hand inflate a truncated stream,
      // which throws rather than returning null; either way, give up on ranges
      // and let the caller fetch the archive whole.
      let entry: Buffer | null = null
      try {
        entry = raw ? unzipEntry(raw, wanted) : null
      } catch {
        entry = null
      }
      if (!entry) return null
      found.set(wanted, entry)
      console.log(`  ${C.dim('ranged ')} ${name} ${C.dim(mb(entry.length))}`)
    }
    pos += 46 + nameLen + extraLen + commentLen
  }
  return found.size === names.length ? found : null
}

/** Read a PDS3 keyword. Values carry units (`2.0<PIX/DEG>`), so parse loosely. */
function pdsValue(label: string, key: string): string | null {
  const m = label.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'))
  return m ? m[1]!.trim() : null
}

function pdsNumber(label: string, key: string): number {
  const raw = pdsValue(label, key)
  const n = raw === null ? NaN : Number.parseFloat(raw)
  if (!Number.isFinite(n)) throw new Error(`PDS label has no numeric ${key}`)
  return n
}

interface GriddedTopoSpec {
  body: string
  out: string
  /** Zip archive, on a host that serves range requests. */
  url: string
  /** Name fragments of the PDS3 images to merge; together they must tile the globe. */
  entries: string[]
  /** Output grid. */
  width: number
  height: number
  credit: string
  note: string
}

const GRIDDED_TOPO: GriddedTopoSpec[] = [
  {
    body: 'moon:Titan',
    out: 'titan_relief.png',
    url: 'https://asc-astropedia.s3.us-west-2.amazonaws.com/Titan/Cassini/GTDR/gtdr-data.zip',
    // GTI = the tensioned-spline interpolation through every Cassini RADAR
    // altimetry and SARTopo track from flybys TA to T77; EB = 2 px/deg; N090
    // and N270 are the two hemispheres, named for the west longitude at their
    // centres. The archive's own GTDR_info.pdf spells the naming out, which is
    // how the interpolated model was picked out of twenty-odd ellipsoid and
    // spherical-harmonic fits sitting beside it.
    entries: ['GTIEB00N090_T077_V01.IMG', 'GTIEB00N270_T077_V01.IMG'],
    // 2 px/deg globally, so the output grid is the source grid: no resampling.
    width: 720,
    height: 360,
    credit: 'Cassini RADAR GTDR (Lorenz et al. 2013) — USGS Astrogeology',
    note: 'Cassini RADAR altimetry + SARTopo, 2 px/deg',
  },
]

/**
 * Merge PDS3 equirectangular float grids into one elevation map.
 *
 * Everything about where a sample sits comes out of the label: PDS states the
 * projection as an offset and a resolution, so
 *
 *   latitude  = (LINE_PROJECTION_OFFSET + 1 - line) / MAP_RESOLUTION
 *   longitude = CENTER_LONGITUDE -/+ (sample - SAMPLE_PROJECTION_OFFSET - 1) / MAP_RESOLUTION
 *
 * with the sign set by POSITIVE_LONGITUDE_DIRECTION. Both are checked against
 * the label's own declared latitude and longitude bounds before anything is
 * written, so a misread offset fails here rather than producing a mirrored
 * world that still looks like a world.
 *
 * Elevations stay on the datum the product publishes them against. Aphelion's
 * radius for the body may differ by a few hundred metres, but that is a uniform
 * change of sphere size, not of shape — and leaving the numbers as published is
 * what lets `pnpm validate` compare the map's mean radius against the entirely
 * independent JPL figure.
 */
async function buildGriddedTopo(spec: GriddedTopoSpec): Promise<ReliefResult | null> {
  const cachePath = path.join(CACHE, path.basename(spec.url))
  let entries = (await exists(cachePath)) ? null : await fetchZipEntries(spec.url, spec.entries)
  if (!entries) {
    // No ranges, or the archive is already cached in full from an earlier run.
    console.log(`  ${C.dim('       ')} ${spec.out}: reading the whole archive`)
    if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) return null
    const whole = await fs.readFile(cachePath)
    entries = new Map()
    for (const name of spec.entries) {
      const entry = unzipEntry(whole, name)
      if (!entry) {
        console.log(`  ${C.red('bad    ')} ${spec.out}: no zip entry matching ${name}`)
        return null
      }
      entries.set(name, entry)
    }
  }

  const w = spec.width
  const h = spec.height
  const sum = new Float64Array(w * h)
  const hits = new Uint32Array(w * h)

  for (const name of spec.entries) {
    // The archive stores each image gzipped inside the zip.
    const img = gunzipSync(entries.get(name)!)
    const label = img.toString('latin1', 0, Math.min(img.length, 32768))

    const recordBytes = pdsNumber(label, 'RECORD_BYTES')
    const labelRecords = pdsNumber(label, 'LABEL_RECORDS')
    const lines = pdsNumber(label, 'LINES')
    const samples = pdsNumber(label, 'LINE_SAMPLES')
    const bits = pdsNumber(label, 'SAMPLE_BITS')
    const type = pdsValue(label, 'SAMPLE_TYPE')
    // PC_REAL is little-endian IEEE 754. Refuse anything else rather than
    // reading a different layout as if it were this one.
    if (type !== 'PC_REAL' || bits !== 32) {
      console.log(`  ${C.red('bad    ')} ${spec.out}: ${name} is ${bits}-bit ${type}, expected 32-bit PC_REAL`)
      return null
    }
    const dataStart = labelRecords * recordBytes
    if (img.length < dataStart + lines * samples * 4) {
      console.log(`  ${C.red('bad    ')} ${spec.out}: ${name} is ${img.length} bytes, too short for ${samples}x${lines}`)
      return null
    }

    const res = pdsNumber(label, 'MAP_RESOLUTION')
    const centreLon = pdsNumber(label, 'CENTER_LONGITUDE')
    const lineOffset = pdsNumber(label, 'LINE_PROJECTION_OFFSET')
    const sampleOffset = pdsNumber(label, 'SAMPLE_PROJECTION_OFFSET')
    const positive = pdsValue(label, 'POSITIVE_LONGITUDE_DIRECTION')
    if (positive !== 'WEST' && positive !== 'EAST') {
      console.log(`  ${C.red('bad    ')} ${spec.out}: ${name} has POSITIVE_LONGITUDE_DIRECTION ${positive}`)
      return null
    }
    const sign = positive === 'WEST' ? -1 : 1

    // Samples are 1-based in the PDS formulae. `lonOf` stays in the product's
    // own direction so it can be checked against the label; the conversion to
    // east longitude happens once, afterwards.
    const latOf = (line: number) => (lineOffset + 1 - line) / res
    const lonOf = (sample: number) => centreLon + (sign * (sample - sampleOffset - 1)) / res
    const eastOf = (lon: number) => ((((positive === 'WEST' ? -lon : lon) % 360) + 360) % 360)

    // The label states its extent independently of the offsets that produce it,
    // so the two have to agree. This is the only warning either file gives
    // before a silently mirrored world, and the two hemispheres disagree about
    // SAMPLE_PROJECTION_OFFSET by 360 pixels, which is exactly the kind of thing
    // one would otherwise get half right.
    const halfCell = 0.5 / res
    const spans = (a: number, b: number, lo: number, hi: number) =>
      Math.abs(Math.min(a, b) - halfCell - lo) < 1e-3 && Math.abs(Math.max(a, b) + halfCell - hi) < 1e-3
    if (!spans(latOf(1), latOf(lines), pdsNumber(label, 'MINIMUM_LATITUDE'), pdsNumber(label, 'MAXIMUM_LATITUDE'))) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} spans ${latOf(lines).toFixed(2)}..${latOf(1).toFixed(2)}N,` +
          ` label declares ${pdsNumber(label, 'MINIMUM_LATITUDE')}..${pdsNumber(label, 'MAXIMUM_LATITUDE')}`,
      )
      return null
    }
    // A whole-globe product declares both bounds equal and the check says
    // nothing; these hemispheres declare real edges, which is the case worth
    // catching.
    const lonLo = pdsNumber(label, 'EASTERNMOST_LONGITUDE')
    const lonHi = pdsNumber(label, 'WESTERNMOST_LONGITUDE')
    if (lonLo !== lonHi && !spans(lonOf(1), lonOf(samples), Math.min(lonLo, lonHi), Math.max(lonLo, lonHi))) {
      console.log(
        `  ${C.red('bad    ')} ${spec.out}: ${name} spans ${lonOf(1).toFixed(2)}..${lonOf(samples).toFixed(2)}` +
          ` ${positive}, label declares ${lonLo}..${lonHi}`,
      )
      return null
    }

    const missing = Number.parseInt(
      (pdsValue(label, 'MISSING_CONSTANT') ?? '').replace(/^16#|#$/g, ''),
      16,
    )
    for (let line = 1; line <= lines; line++) {
      const lat = latOf(line)
      const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)))
      for (let s = 1; s <= samples; s++) {
        const at = dataStart + ((line - 1) * samples + (s - 1)) * 4
        if (Number.isFinite(missing) && img.readUInt32LE(at) === missing) continue
        const u = ((eastOf(lonOf(s)) - 180) / 360 + 1) % 1
        const x = Math.min(w - 1, Math.floor(u * w))
        sum[y * w + x]! += img.readFloatLE(at)
        hits[y * w + x]!++
      }
    }
  }

  let empty = 0
  let min = Infinity
  let max = -Infinity
  const metres = new Float64Array(w * h)
  for (let i = 0; i < metres.length; i++) {
    if (hits[i] === 0) {
      empty++
      continue
    }
    const v = sum[i]! / hits[i]!
    metres[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  if (empty > 0) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: ${empty} output cells received no samples`)
    return null
  }

  const span = max - min
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < metres.length; i++) {
    const t = Math.round(((metres[i]! - min) / span) * 65535)
    rgb[i * 3] = (t >> 8) & 0xff
    rgb[i * 3 + 1] = t & 0xff
  }

  await fs.mkdir(SHAPES, { recursive: true })
  const png = encodePng(w, h, rgb)
  await fs.writeFile(path.join(SHAPES, spec.out), png)
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h}, ${(min / 1000).toFixed(2)}..${(max / 1000).toFixed(2)} km, ${mb(png.length)}`,
    )}`,
  )

  return {
    body: spec.body,
    out: spec.out,
    width: w,
    height: h,
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

  const text = await fs.readFile(cachePath, 'utf8')
  const radii =
    spec.format === 'lat-lon-table'
      ? sampleLatLonTable(spec, text)
      : await rasteriseCubeQuad(spec, text)
  if (!radii) return null
  return finishShape(spec, radii)
}

/**
 * Resample a latitude/longitude/radius table onto the output grid.
 *
 * The table is a regular grid, so this is a bilinear lookup — but two of its
 * conventions are the reverse of ours and both are silent if missed: rows run
 * south to north where our maps put north first, and longitudes start at the
 * prime meridian where our maps start at 180 west. Driving the output loop from
 * the target's own coordinates rather than the source's makes both fall out.
 */
function sampleLatLonTable(spec: ShapeModelSpec, text: string): Float64Array | null {
  const rows: [number, number, number][] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const p = t.split(/\s+/).map(Number)
    if (p.length < 3 || p.some((v) => !Number.isFinite(v))) {
      console.log(`  ${C.red('bad    ')} ${spec.out}: unparseable row "${t.slice(0, 40)}"`)
      return null
    }
    rows.push([p[0]!, p[1]!, p[2]!])
  }

  const lats = [...new Set(rows.map((r) => r[0]))].sort((a, b) => a - b)
  const lons = [...new Set(rows.map((r) => r[1]))].sort((a, b) => a - b)
  if (lats.length * lons.length !== rows.length) {
    console.log(
      `  ${C.red('bad    ')} ${spec.out}: ${rows.length} rows is not ${lats.length} x ${lons.length}`,
    )
    return null
  }

  const latIx = new Map(lats.map((v, i) => [v, i]))
  const lonIx = new Map(lons.map((v, i) => [v, i]))
  const grid = new Float64Array(lats.length * lons.length)
  for (const [la, lo, r] of rows) grid[latIx.get(la)! * lons.length + lonIx.get(lo)!] = r

  const latMin = lats[0]!
  const latStep = (lats[lats.length - 1]! - latMin) / (lats.length - 1)
  const lonMin = lons[0]!
  const lonStep = (lons[lons.length - 1]! - lonMin) / (lons.length - 1)

  const sample = (lat: number, lon: number): number => {
    const fy = Math.min(lats.length - 1.0001, Math.max(0, (lat - latMin) / latStep))
    const fx = Math.min(lons.length - 1.0001, Math.max(0, (lon - lonMin) / lonStep))
    const y0 = Math.floor(fy)
    const x0 = Math.floor(fx)
    const ty = fy - y0
    const tx = fx - x0
    const g = (y: number, x: number) => grid[y * lons.length + x]!
    return (
      g(y0, x0) * (1 - tx) * (1 - ty) +
      g(y0, x0 + 1) * tx * (1 - ty) +
      g(y0 + 1, x0) * (1 - tx) * ty +
      g(y0 + 1, x0 + 1) * tx * ty
    )
  }

  const out = new Float64Array(spec.width * spec.height)
  for (let y = 0; y < spec.height; y++) {
    const lat = 90 - ((y + 0.5) * 180) / spec.height
    for (let x = 0; x < spec.width; x++) {
      const lon = (180 + ((x + 0.5) * 360) / spec.width) % 360
      out[y * spec.width + x] = sample(lat, lon)
    }
  }
  return out
}

async function rasteriseCubeQuad(
  spec: ShapeModelSpec,
  text: string,
): Promise<Float64Array | null> {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
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
  return radii
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
  const w = spec.width
  const h = spec.height

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
// 2d. FITS mosaics  (public domain)
//
// A couple of bodies have real imagery that exists only as a FITS array in a
// PDS archive rather than as a browse image. FITS is a short read — 2880-byte
// blocks of 80-character ASCII cards, then the raw array — so this pulls them
// straight into a texture rather than leaving the body to the procedural
// generator, which serves small irregular moons particularly badly.
// ---------------------------------------------------------------------------

interface FitsMosaicSpec {
  out: string
  url: string
  /** East longitude of the array's left-hand column, degrees. */
  originLonEast: number
  /** True when row 0 is the southernmost, as FITS and IDL conventionally store. */
  bottomUp: boolean
  /** Pixels equal to this are unimaged and get flattened to the image mean. */
  blankValue?: number
  credit: string
  note: string
}

const FITS_MOSAICS: FitsMosaicSpec[] = [
  {
    out: 'deimos.png',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimosm.fit',
    originLonEast: 0,
    // Not stated in the header, but the shape table in the same bundle by the
    // same author is explicitly south-first, and this array's unimaged gap then
    // lands on the same longitudes *and* latitudes as that model's oddly smooth
    // southern depression — which is what an uncovered region would produce.
    // Two independent products agreeing is the best evidence available here.
    bottomUp: true,
    blankValue: 0,
    credit: 'Thomas Deimos mosaic (Viking) — PDS Small Bodies Node',
    note: 'Viking mosaic, high-pass filtered',
  },
]

async function buildFitsMosaic(spec: FitsMosaicSpec): Promise<boolean> {
  const cachePath = path.join(CACHE, path.basename(spec.url))
  if (!(await download(spec.url, cachePath, `${spec.out} ${C.dim(spec.note)}`))) return false

  const buf = await fs.readFile(cachePath)
  // Header is whole 2880-byte blocks of 80-character cards, ending at END.
  const card = (name: string): string | null => {
    for (let off = 0; off + 80 <= buf.length; off += 80) {
      const text = buf.toString('ascii', off, off + 80)
      if (text.startsWith('END ') || text.trimEnd() === 'END') return null
      if (text.startsWith(name.padEnd(8))) return text.slice(10).split('/')[0]!.trim()
    }
    return null
  }
  const bitpix = Number(card('BITPIX'))
  const w = Number(card('NAXIS1'))
  const h = Number(card('NAXIS2'))
  if (bitpix !== 8 || !w || !h) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: expected 8-bit 2D FITS, got BITPIX ${bitpix} ${w}x${h}`)
    return false
  }

  let headerEnd = 0
  for (let off = 0; off + 80 <= buf.length; off += 80) {
    const text = buf.toString('ascii', off, off + 80)
    if (text.startsWith('END ') || text.trimEnd() === 'END') {
      headerEnd = Math.ceil((off + 80) / 2880) * 2880
      break
    }
  }
  const data = buf.subarray(headerEnd, headerEnd + w * h)
  if (data.length !== w * h) {
    console.log(`  ${C.red('bad    ')} ${spec.out}: expected ${w * h} pixels, got ${data.length}`)
    return false
  }

  // Mean of the imaged pixels, used to flatten the gaps.
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i++) {
    if (spec.blankValue !== undefined && data[i] === spec.blankValue) continue
    sum += data[i]!
    count++
  }
  const fill = count ? Math.round(sum / count) : 128
  const blanks = data.length - count

  const shift = Math.round((w * (180 - spec.originLonEast)) / 360)
  const out = Buffer.alloc(w * h)
  for (let y = 0; y < h; y++) {
    const src = spec.bottomUp ? h - 1 - y : y
    for (let x = 0; x < w; x++) {
      const v = data[src * w + ((x + shift) % w)]!
      // Unimaged terrain is flattened rather than smeared: a flat patch reads as
      // "nothing was seen here", where dilating the neighbours would invent
      // surface that no spacecraft ever resolved.
      out[y * w + x] = spec.blankValue !== undefined && v === spec.blankValue ? fill : v
    }
  }

  await fs.mkdir(TEXTURES, { recursive: true })
  const png = encodePng(w, h, out, 1)
  await fs.writeFile(path.join(TEXTURES, spec.out), png)
  console.log(
    `  ${C.green('wrote  ')} ${spec.out} ${C.dim(
      `${w}x${h} grey, ${((blanks / data.length) * 100).toFixed(1)}% unimaged filled, ${mb(png.length)}`,
    )}`,
  )
  return true
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
// 6. Hipparcos star catalogue  (ESA 1997, via CDS)
//
// The stars Aphelion draws as points, complementing the SVS deep-sky texture
// above: that image has the Hipparcos and Tycho stars removed, and these put
// them back as real point sources rather than baked texels. Sharp at any
// display resolution, correctly coloured from B-V, and -- because the clock
// spans 1600 to 2500 -- carrying their proper motions.
//
// Output is a packed binary in public/sky/, not a TypeScript literal: 41k stars
// is ~540 KB packed and would be several megabytes as source text. The
// generated module beside it records the layout and the count, so a stale
// binary is caught by a mismatch rather than by a garbled sky.
// ---------------------------------------------------------------------------

const HIPPARCOS_URL = 'https://cdsarc.cds.unistra.fr/ftp/I/239/hip_main.dat'

/**
 * Faintest star to store.
 *
 * Hipparcos is complete to V = 7.3 everywhere and to about 9 away from the
 * galactic plane, so 8.0 is drawn from a near-complete sample and the thinning
 * that does exist is concentrated in the plane -- exactly where the deep-sky
 * texture is brightest and hides it. It is also the magnitude at which NASA
 * switched from Hipparcos to Tycho when building that texture, so the two
 * layers meet where the source data does.
 */
const STAR_MAG_LIMIT = 8.0

/** Catalogue epoch of the Hipparcos astrometry; positions are propagated to J2000. */
const HIPPARCOS_EPOCH = 1991.25

const STAR_FILE = 'stars.bin'
const STAR_MAGIC = 0x52545341 // 'ASTR' little-endian

interface Star {
  /** Right ascension and declination at J2000.0, radians. */
  ra: number
  dec: number
  /** Proper motion, mas/yr; pmRA already carries the cos(dec) factor. */
  pmRA: number
  pmDec: number
  vmag: number
  rgb: [number, number, number]
}

/**
 * Effective temperature from the Johnson B-V colour index (Ballesteros 2012).
 *
 * Reproduces the Sun at 5757 K from B-V = 0.656 (true value 5772) and Rigel at
 * 10516 K from -0.03 (about 11000). The clamp matters: the second term has a
 * pole at B-V = -0.674, and a handful of catalogue entries carry colours that
 * unphysical.
 */
function temperatureFromBV(bv: number): number {
  const c = Math.max(-0.4, Math.min(2.0, bv))
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62))
}

/**
 * Blackbody colour, as a multi-lobe Gaussian fit to the CIE 1931 colour
 * matching functions (Wyman, Sloan & Shirley 2013) integrated against Planck's
 * law, then converted to sRGB primaries.
 *
 * Done here rather than in the shader because it is a per-star constant, and
 * because getting it wrong is invisible on screen but obvious in a table:
 * B stars must come out blue-white and M stars orange, never red.
 */
function colourFromTemperature(kelvin: number): [number, number, number] {
  const lobe = (x: number, mu: number, s1: number, s2: number): number => {
    const t = (x - mu) / (x < mu ? s1 : s2)
    return Math.exp(-0.5 * t * t)
  }
  let X = 0
  let Y = 0
  let Z = 0
  for (let nm = 360; nm <= 830; nm += 2) {
    const l = nm * 1e-9
    // Planck's law, spectral radiance per wavelength. The leading constants
    // cancel in the normalisation below, but are kept so the units are real.
    const planck = 3.7417718e-16 / (l ** 5 * (Math.exp(1.4387769e-2 / (l * kelvin)) - 1))
    X +=
      planck *
      (1.056 * lobe(nm, 599.8, 37.9, 31.0) +
        0.362 * lobe(nm, 442.0, 16.0, 26.7) -
        0.065 * lobe(nm, 501.1, 20.4, 26.2))
    Y += planck * (0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1))
    Z += planck * (1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8))
  }
  const sum = X + Y + Z || 1
  X /= sum
  Y /= sum
  Z /= sum

  // XYZ -> linear sRGB (IEC 61966-2-1, D65).
  const linear = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ].map((c) => Math.max(0, c))

  // Store chromaticity only, normalised so the strongest channel is full. How
  // *bright* the star is comes from its magnitude, and the renderer divides
  // this colour by its own luminance so the two never fight.
  const peak = Math.max(linear[0]!, linear[1]!, linear[2]!) || 1
  return linear.map((c) => {
    const u = Math.max(0, Math.min(1, c / peak))
    const encoded = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
    return Math.round(255 * encoded)
  }) as [number, number, number]
}

async function buildStarCatalogue(): Promise<Star[] | null> {
  const dest = path.join(CACHE, 'hip_main.dat')
  if (!(await download(HIPPARCOS_URL, dest, 'Hipparcos main catalogue (I/239)'))) return null
  const text = await fs.readFile(dest, 'utf8')

  const DEG = Math.PI / 180
  const MAS = (1 / 3_600_000) * DEG
  // Hipparcos positions are given for 1991.25; everything else in Aphelion is
  // J2000, so the astrometry is propagated forward once, here.
  const toJ2000 = 2000.0 - HIPPARCOS_EPOCH

  const stars: Star[] = []
  let skipped = 0
  for (const line of text.split('\n')) {
    // Fixed columns, per the catalogue ReadMe: Vmag H5, RAdeg H8, DEdeg H9,
    // pmRA H12, pmDE H13, B-V H37.
    if (line.length < 251) continue
    const vmag = Number(line.slice(41, 46))
    const raDeg = Number(line.slice(51, 63))
    const decDeg = Number(line.slice(64, 76))
    if (!Number.isFinite(vmag) || !Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
      skipped++
      continue
    }
    if (line.slice(51, 63).trim() === '' || line.slice(41, 46).trim() === '') {
      skipped++
      continue
    }
    if (vmag > STAR_MAG_LIMIT) continue

    const pmRA = Number(line.slice(87, 95)) || 0
    const pmDec = Number(line.slice(96, 104)) || 0
    const bvRaw = line.slice(245, 251).trim()
    // A star with no measured colour is almost always a faint one; A0 (B-V = 0)
    // is the least committal guess and reads as plain white.
    const bv = bvRaw === '' ? 0 : Number(bvRaw)

    // Propagate as a vector rather than by adding to RA and dividing by cos(dec):
    // Polaris sits at dec 89.26, where that division amplifies its 44 mas/yr into
    // nonsense, and the vector form is singular nowhere.
    const ra = raDeg * DEG
    const dec = decDeg * DEG
    const cd = Math.cos(dec)
    const sd = Math.sin(dec)
    const ca = Math.cos(ra)
    const sa = Math.sin(ra)
    // East and north unit vectors at the star, in equatorial coordinates.
    const east = [-sa, ca, 0]
    const north = [-sd * ca, -sd * sa, cd]
    const p = [cd * ca, cd * sa, sd].map(
      (c, i) => c + (pmRA * east[i]! + pmDec * north[i]!) * MAS * toJ2000,
    )
    const len = Math.hypot(p[0]!, p[1]!, p[2]!) || 1

    stars.push({
      ra: Math.atan2(p[1]!, p[0]!),
      dec: Math.asin(Math.max(-1, Math.min(1, p[2]! / len))),
      pmRA,
      pmDec,
      vmag,
      rgb: colourFromTemperature(temperatureFromBV(Number.isFinite(bv) ? bv : 0)),
    })
  }

  if (skipped) console.log(`  ${C.dim('skip   ')} ${skipped} rows without usable astrometry`)
  return stars.length ? stars : null
}

/**
 * Write the packed catalogue and the module that describes it.
 *
 * Struct of arrays rather than interleaved records, so each block uploads to
 * the GPU as one buffer attribute with no unpacking pass. The 16-byte header
 * keeps the 2-byte blocks aligned.
 */
async function writeStarCatalogue(stars: Star[]): Promise<void> {
  const n = stars.length
  const HEADER = 16
  const bytes = HEADER + n * 2 + n * 2 + n * 4 + n * 2 + n * 3
  const buf = Buffer.alloc(bytes)

  buf.writeUInt32LE(STAR_MAGIC, 0)
  buf.writeUInt32LE(1, 4) // format version
  buf.writeUInt32LE(n, 8)
  buf.writeFloatLE(STAR_MAG_LIMIT, 12)

  let o = HEADER
  const raAt = o
  o += n * 2
  const decAt = o
  o += n * 2
  const pmAt = o
  o += n * 4
  const magAt = o
  o += n * 2
  const rgbAt = o

  const TWO_PI = Math.PI * 2
  for (let i = 0; i < n; i++) {
    const s = stars[i]!
    // RA spans a full turn, so it uses the whole unsigned range; dec spans half
    // a turn about zero, so it uses the signed one. Both quantise to under
    // 20 arcsec, a fifth of a pixel at this field of view.
    buf.writeUInt16LE(Math.round((((s.ra % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI * 65536) % 65536, raAt + i * 2)
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((s.dec / (Math.PI / 2)) * 32767))), decAt + i * 2)
    const clampPm = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)))
    buf.writeInt16LE(clampPm(s.pmRA), pmAt + i * 4)
    buf.writeInt16LE(clampPm(s.pmDec), pmAt + i * 4 + 2)
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s.vmag * 1000))), magAt + i * 2)
    buf[rgbAt + i * 3] = s.rgb[0]
    buf[rgbAt + i * 3 + 1] = s.rgb[1]
    buf[rgbAt + i * 3 + 2] = s.rgb[2]
  }

  await fs.mkdir(SKY, { recursive: true })
  await fs.writeFile(path.join(SKY, STAR_FILE), buf)
  console.log(`  ${C.green('wrote  ')} public/sky/${STAR_FILE} ${C.dim(`(${n} stars, ${mb(bytes)})`)}`)

  const brightest = [...stars].sort((a, b) => a.vmag - b.vmag)[0]!
  const src = `/**
 * GENERATED by scripts/fetch-assets.ts -- do not edit by hand.
 *
 * Describes public/sky/${STAR_FILE}, the packed Hipparcos catalogue the sky
 * draws as point sources. The binary carries the same count and magnitude limit
 * in its header; the loader compares the two so a stale file is refused rather
 * than rendered as a wrong sky.
 *
 * Positions are ICRF/J2000 right ascension and declination, propagated from the
 * catalogue epoch J${HIPPARCOS_EPOCH} with each star's own proper motion. They are NOT
 * precessed to date at runtime and must not be: Aphelion's frame is inertial
 * (ecliptic J2000), so precession moves the coordinate grid, not the stars.
 *
 * Layout, little-endian, after a 16-byte header of
 * [magic u32, version u32, count u32, magnitudeLimit f32]:
 *
 *   Uint16Array[count]      right ascension, full turn over the u16 range
 *   Int16Array[count]       declination, +-90 deg over the i16 range
 *   Int16Array[count * 2]   proper motion (RA*cos dec, dec), mas/yr
 *   Int16Array[count]       Johnson V magnitude, millimagnitudes
 *   Uint8Array[count * 3]   sRGB chromaticity from the B-V colour index
 */

export const STAR_CATALOGUE = {
  /** Path under public/, loaded at runtime like a texture. */
  file: 'sky/${STAR_FILE}',
  count: ${n},
  /** Faintest V magnitude present. */
  magnitudeLimit: ${STAR_MAG_LIMIT},
  /** Epoch the positions were propagated to, as a Julian year. */
  epoch: 2000.0,
  /** Byte offset of the first array; the header occupies everything before it. */
  headerBytes: ${HEADER},
  magic: ${STAR_MAGIC},
  version: 1,
} as const
`
  await fs.mkdir(GENERATED, { recursive: true })
  await fs.writeFile(path.join(GENERATED, 'stars.ts'), src)
  console.log(
    `  ${C.green('wrote  ')} src/data/generated/stars.ts ${C.dim(`(brightest V ${brightest.vmag.toFixed(2)})`)}`,
  )
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

    step('NASA SVS Deep Star Maps 2020 (public domain)')
    for (const spec of skyTextures()) {
      const outPath = path.join(TEXTURES, spec.out)
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`)
        continue
      }
      const cachePath = path.join(CACHE, spec.source)
      if (!(await download(SVS_BASE + spec.source, cachePath, `${spec.out} ${C.dim(spec.note)}`))) {
        failures.push(spec.out)
        continue
      }
      // Mirrored, because right ascension runs the other way on this product.
      queueConvert(cachePath, outPath, spec.maxDim, '', true)
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
        queueConvert(cachePath, outPath, spec.maxDim, spec.roll)
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

    step('PDS FITS mosaics (public domain)')
    for (const spec of FITS_MOSAICS) {
      const outPath = path.join(TEXTURES, spec.out)
      if (await exists(outPath)) {
        console.log(`  ${C.dim('have   ')} ${spec.out}`)
        continue
      }
      if (!(await buildFitsMosaic(spec))) failures.push(spec.out)
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
    for (const spec of GRIDDED_TOPO) {
      const result = await buildGriddedTopo(spec)
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
    if (relief.length === RELIEF.length + GRIDDED_TOPO.length + SHAPE_MODELS.length)
      await writeReliefModule(relief)
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

    step('Hipparcos star catalogue (ESA 1997)')
    const stars = await buildStarCatalogue()
    if (stars) await writeStarCatalogue(stars)
    else {
      console.log(C.yellow('  could not build the star catalogue; existing files left in place'))
      failures.push('stars.bin')
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
