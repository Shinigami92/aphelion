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
 *   - JPL Solar System Dynamics satellite elements + physical parameters
 *   - IAU Minor Planet Center MPCORB / Distant.txt orbit catalogues
 */

import { createGunzip } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache')
const TEXTURES = path.join(ROOT, 'public', 'textures')
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
