/**
 * The view, encoded in the URL.
 *
 * Everything needed to reconstruct what someone is looking at goes in the query
 * string, so a link can be pasted into a chat and land the recipient on the same
 * body, at the same instant, from the same angle — and so a reload is a no-op
 * rather than a reset.
 *
 * Two deliberate choices:
 *
 *   - **Camera distance is stored in radii of the focused body**, not kilometres
 *     or scene units. Radii are exact in both scale modes (a body and its
 *     surroundings scale uniformly), so the same link frames the body identically
 *     whether the recipient lands in explore or true scale.
 *   - **Only non-default values are written.** The default view is a bare URL,
 *     and a shared link stays short enough to read.
 *
 * Writes go through `history.replaceState`, never `pushState`: with a live clock
 * the state changes every second and pushing would bury the back button.
 */

import { RATE_PRESETS } from './time.ts'
import { formatUtc, parseUtc } from '../astro/timescales.ts'

// These mirror the unions in render/scene.ts and core/scale.ts. They are
// redeclared rather than imported so this module stays free of the render layer;
// TypeScript's structural typing makes them assignable in both directions.
const ORBIT_MODES = ['none', 'planets', 'all'] as const
const LABEL_MODES = ['none', 'major', 'all'] as const
const SCALE_MODES = ['explore', 'true'] as const
const CAMERA_MODES = ['orbit', 'free'] as const

export type UrlOrbitMode = (typeof ORBIT_MODES)[number]
export type UrlLabelMode = (typeof LABEL_MODES)[number]
export type UrlScaleMode = (typeof SCALE_MODES)[number]
export type UrlCameraMode = (typeof CAMERA_MODES)[number]

export interface ViewToggles {
  belts: boolean
  rings: boolean
  atmospheres: boolean
  milkyway: boolean
  minorBodies: boolean
}

export interface SharedView {
  /** UTC Julian Date. */
  jdUtc: number
  focusKey: string
  /** Only meaningful when it differs from the focus. */
  selectedKey: string | null
  scaleMode: UrlScaleMode
  /** Signed simulated seconds per real second. */
  rate: number
  paused: boolean
  /** Camera azimuth and elevation about the focus, radians. */
  azimuth: number
  elevation: number
  /** Camera distance from the focus centre, in radii of the focused body. */
  distanceRadii: number
  /** Whether the camera is orbiting the focus or flying free. */
  cameraMode: UrlCameraMode
  /**
   * Free-flight position relative to the focus, in radii of the focused body,
   * and orientation as a quaternion. Null unless the camera is flying free.
   *
   * Radii for the same reason `distanceRadii` uses them: a free camera parked
   * beside a moon has to arrive beside that moon whichever scale mode the
   * recipient opens the link in. The orientation is stored outright rather than
   * as a look-at target, because in free flight where you are pointing is not
   * derivable from anything else — that is the whole difference from orbit mode,
   * and losing it is what made a reload snap back to facing the focus.
   */
  freePosition: readonly [number, number, number] | null
  freeOrientation: readonly [number, number, number, number] | null
  orbits: UrlOrbitMode
  labels: UrlLabelMode
  toggles: ViewToggles
}

export const DEFAULT_ORBITS: UrlOrbitMode = 'planets'
export const DEFAULT_LABELS: UrlLabelMode = 'major'
export const DEFAULT_TOGGLES: ViewToggles = {
  belts: true,
  rings: true,
  atmospheres: true,
  milkyway: true,
  minorBodies: true,
}

/**
 * Query parameter name for each boolean toggle.
 *
 * `orrery` used to be one of these, back when the map had a checkbox of its own;
 * it folds away with every other panel now, and a link carrying the old
 * parameter is ignored the same way any other unknown one is.
 */
const TOGGLE_PARAMS: ReadonlyArray<readonly [keyof ViewToggles, string]> = [
  ['belts', 'belts'],
  ['rings', 'rings'],
  ['atmospheres', 'atmo'],
  ['milkyway', 'milkyway'],
  ['minorBodies', 'minor'],
]

/**
 * Percent-encode, but leave `:` legible. Body keys look like `moon:Io`, and a URL
 * full of `%3A` is unpleasant to read in a chat window. Colons are legal in a
 * query string; spaces (minor planets such as `sb:2002 MS4`) still get encoded.
 */
const enc = (s: string): string => encodeURIComponent(s).replace(/%3A/gi, ':')

const round = (x: number, places = 4): number => Number(x.toFixed(places))

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export function encodeView(v: SharedView): string {
  const parts: string[] = []

  // `YYYY-MM-DDTHH:MM:SSZ` — second precision, which is also how often a live
  // clock changes the URL.
  parts.push(`t=${enc(`${formatUtc(v.jdUtc).replace(' ', 'T')}Z`)}`)
  parts.push(`focus=${enc(v.focusKey)}`)
  if (v.selectedKey && v.selectedKey !== v.focusKey) parts.push(`sel=${enc(v.selectedKey)}`)
  if (v.scaleMode !== 'explore') parts.push(`mode=${v.scaleMode}`)
  parts.push(`rate=${v.rate}`)
  if (v.paused) parts.push('paused=1')
  parts.push(`az=${round(v.azimuth)}`)
  parts.push(`el=${round(v.elevation)}`)
  parts.push(`d=${round(v.distanceRadii, 3)}`)
  if (v.cameraMode === 'free') {
    parts.push('cam=free')
    // Six places, not the usual four. In radii of the focused body, four places
    // is ~36 km at Saturn — invisible for a planet, but enough to drop you
    // beside a different boulder when you were parked in the rings.
    if (v.freePosition) parts.push(`fp=${v.freePosition.map((n) => round(n, 6)).join(',')}`)
    if (v.freeOrientation) parts.push(`fq=${v.freeOrientation.map((n) => round(n, 5)).join(',')}`)
  }
  if (v.orbits !== DEFAULT_ORBITS) parts.push(`orbits=${v.orbits}`)
  if (v.labels !== DEFAULT_LABELS) parts.push(`labels=${v.labels}`)
  for (const [key, param] of TOGGLE_PARAMS) {
    if (v.toggles[key] !== DEFAULT_TOGGLES[key]) parts.push(`${param}=${v.toggles[key] ? 1 : 0}`)
  }

  return parts.join('&')
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Read a shared view out of a query string.
 *
 * Every field is optional and every malformed field is ignored rather than
 * throwing: a hand-edited or truncated link should still open the app, just with
 * fewer things restored.
 */
export function parseView(search: string): Partial<SharedView> {
  const q = new URLSearchParams(search)
  const out: Partial<SharedView> = {}

  const t = q.get('t')
  if (t) {
    const jd = parseUtc(t.replace('T', ' ').replace(/Z$/i, ''))
    if (jd !== null) out.jdUtc = jd
  }

  const focus = q.get('focus')
  if (focus) out.focusKey = focus
  const sel = q.get('sel')
  if (sel) out.selectedKey = sel

  const mode = q.get('mode')
  if (mode && (SCALE_MODES as readonly string[]).includes(mode)) out.scaleMode = mode as UrlScaleMode

  const rate = q.get('rate')
  if (rate !== null) {
    const value = Number(rate)
    if (Number.isFinite(value) && value !== 0) out.rate = value
  }

  const paused = q.get('paused')
  if (paused !== null) out.paused = paused === '1' || paused === 'true'

  const num = (name: string): number | undefined => {
    const raw = q.get(name)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  const az = num('az')
  if (az !== undefined) out.azimuth = az
  // Elevation is bounded by geometry, so anything outside the range is garbage
  // rather than something to clamp — `el=999` should leave the default alone, not
  // silently pin the camera over the pole.
  const el = num('el')
  if (el !== undefined && Math.abs(el) <= Math.PI / 2) out.elevation = el
  const d = num('d')
  if (d !== undefined && d > 0) out.distanceRadii = d

  const cam = q.get('cam')
  if (cam && (CAMERA_MODES as readonly string[]).includes(cam)) out.cameraMode = cam as UrlCameraMode

  /** A fixed-length list of finite numbers, or undefined if it is anything else. */
  const vector = (name: string, length: number): number[] | undefined => {
    const raw = q.get(name)
    if (raw === null) return undefined
    const parts = raw.split(',').map(Number)
    if (parts.length !== length || parts.some((n) => !Number.isFinite(n))) return undefined
    return parts
  }
  const fp = vector('fp', 3)
  if (fp) out.freePosition = [fp[0]!, fp[1]!, fp[2]!]
  const fq = vector('fq', 4)
  // A zero-length quaternion cannot be normalised into a rotation.
  if (fq && Math.hypot(fq[0]!, fq[1]!, fq[2]!, fq[3]!) > 1e-6) {
    out.freeOrientation = [fq[0]!, fq[1]!, fq[2]!, fq[3]!]
  }

  const orbits = q.get('orbits')
  if (orbits && (ORBIT_MODES as readonly string[]).includes(orbits)) {
    out.orbits = orbits as UrlOrbitMode
  }
  const labels = q.get('labels')
  if (labels && (LABEL_MODES as readonly string[]).includes(labels)) {
    out.labels = labels as UrlLabelMode
  }

  const toggles: Partial<ViewToggles> = {}
  let sawToggle = false
  for (const [key, param] of TOGGLE_PARAMS) {
    const raw = q.get(param)
    if (raw === null) continue
    // Only explicit values count. Treating anything unrecognised as false let a
    // typo silently switch a layer off, which is the opposite of the
    // ignore-what-you-cannot-parse rule the rest of this function follows.
    if (raw === '1' || raw === 'true') toggles[key] = true
    else if (raw === '0' || raw === 'false') toggles[key] = false
    else continue
    sawToggle = true
  }
  if (sawToggle) out.toggles = { ...DEFAULT_TOGGLES, ...toggles }

  return out
}

/**
 * Nearest entry in the rate ladder to a signed seconds-per-second value, so a
 * link keeps working if the ladder is ever re-tuned.
 */
export function rateToPreset(rate: number): { index: number; direction: 1 | -1 } {
  const magnitude = Math.abs(rate) || 1
  let index = 0
  let best = Infinity
  for (let i = 0; i < RATE_PRESETS.length; i++) {
    // Compare on a log scale: the ladder spans nine orders of magnitude.
    const error = Math.abs(Math.log(RATE_PRESETS[i]!.secondsPerSecond / magnitude))
    if (error < best) {
      best = error
      index = i
    }
  }
  return { index, direction: rate < 0 ? -1 : 1 }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Keeps the address bar in step with the view, cheaply.
 *
 * Rebuilding and writing the URL every frame would be wasteful at 120 fps, so
 * this rebuilds at most every `intervalMs` and only touches history when the
 * string actually changed.
 */
export class UrlWriter {
  private lastQuery: string | null = null
  private lastWriteAt = -Infinity

  private intervalMs: number

  // Written out rather than as a constructor parameter property: `pnpm validate`
  // runs this module under Node's type-stripping, which does not support them.
  constructor(intervalMs = 400) {
    this.intervalMs = intervalMs
  }

  /** Call once per frame with a lazily-evaluated snapshot. */
  sync(nowMs: number, snapshot: () => SharedView): void {
    if (nowMs - this.lastWriteAt < this.intervalMs) return
    this.lastWriteAt = nowMs

    const query = encodeView(snapshot())
    if (query === this.lastQuery) return
    this.lastQuery = query

    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }

  /** Write immediately, ignoring the throttle (used right after a jump). */
  flush(snapshot: () => SharedView): void {
    this.lastWriteAt = -Infinity
    this.sync(Number.POSITIVE_INFINITY, snapshot)
  }
}
