/**
 * Aphelion — entry point.
 *
 * Owns the frame loop and the input bindings, and wires the four independent
 * pieces together:
 *
 *   core/time     the clock (ticks live, pausable, reversible, scrubbable)
 *   core/system   the physics (positions and orientations for ~690 bodies)
 *   render/scene  the picture
 *   ui/*          the panels
 *
 * The loop is strictly ordered: advance the clock, ease the scale, solve the
 * system, move the camera, push everything to the GPU, then update the DOM.
 */

import { AU_KM, SCENE_UNIT_KM } from './core/constants.ts'
import { ScaleModel } from './core/scale.ts'
import { SolarSystem, type SimBody } from './core/system.ts'
import { TimeController } from './core/time.ts'
import {
  parseView,
  rateToPreset,
  UrlWriter,
  type SharedView,
} from './core/url-state.ts'
import { CameraController } from './controls/camera.ts'
import { SceneView, type LabelMode, type OrbitMode, type Quality } from './render/scene.ts'
import { TextureLibrary } from './render/textures.ts'
import {
  BodyBrowser,
  HelpOverlay,
  InfoPanel,
  TimePanel,
  Toast,
  TogglePanel,
  formatDistance,
} from './ui/panels.ts'
import { Minimap } from './ui/minimap.ts'

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const need = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing element #${id}`)
  return node as T
}

const canvas = need<HTMLCanvasElement>('viewport')
const bootEl = need('boot')
const bootFill = need('boot-fill')
const bootStatus = need('boot-status')

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const time = new TimeController()
const scale = new ScaleModel()
const system = new SolarSystem()
const library = new TextureLibrary()

/**
 * A shared view, if the URL carries one.
 *
 * Applied in two passes. The clock and the scale mode have to land before the
 * first solve, because every position and radius downstream depends on them; the
 * camera angle and the view toggles need the panels to exist and so come later.
 */
const shared = parseView(window.location.search)

if (shared.jdUtc !== undefined) time.setJdUtc(shared.jdUtc)
if (shared.rate !== undefined) {
  const { index, direction } = rateToPreset(shared.rate)
  time.setRateIndex(index)
  time.setDirection(direction)
}
if (shared.paused) time.setPaused(true)

scale.setMode(shared.scaleMode ?? 'explore')
scale.snap()

// Solve once before anything reads a radius or a position.
system.update(time.jdTT, scale)

const camera = new CameraController(window.innerWidth / Math.max(1, window.innerHeight))
const scene = new SceneView(canvas, library)
scene.setLabelHost(need('labels'))
scene.currentCamera = camera.camera

/** Unit vector from a body toward the Sun, for daylit-side camera placement. */
function sunwardOf(body: SimBody): { x: number; y: number; z: number } | undefined {
  const r = Math.hypot(body.helioKm.x, body.helioKm.y, body.helioKm.z)
  if (r < 1) return undefined // the Sun itself
  return { x: -body.helioKm.x / r, y: -body.helioKm.y / r, z: -body.helioKm.z / r }
}

/**
 * What the camera orbits is owned by the CameraController; everything here reads
 * it back through this accessor.
 *
 * There used to be a second `focus` variable in this module, which the renderer
 * used to anchor its floating origin while the camera used its own. The two
 * could disagree — and when they did, the camera orbited one body while the
 * world was centred on another, producing a view of empty space with nothing
 * logged. One owner, one accessor.
 */
const focused = (): SimBody => camera.focus ?? system.sun

const initialFocus =
  (shared.focusKey ? system.byKey.get(shared.focusKey) : null) ?? system.byKey.get('earth')!
let selected: SimBody =
  (shared.selectedKey ? system.byKey.get(shared.selectedKey) : null) ?? initialFocus

camera.setFocus(initialFocus, { immediate: true, sunward: sunwardOf(initialFocus) })
// A shared link carries an explicit angle and range; without one, keep the
// daylit-side default setFocus just chose.
camera.restoreView({
  azimuth: shared.azimuth,
  elevation: shared.elevation,
  distanceRadii: shared.distanceRadii,
})

scene.build(system)
scene.setSelected(selected)
scene.setQuality('high')
camera.attach(canvas)

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Canonical home for source, data provenance and licences. */
const REPO_URL = 'https://github.com/Shinigami92/aphelion'

const timePanel = new TimePanel(need('time-panel'), time, () => help.toggle())
const infoPanel = new InfoPanel(need('info'))
const toast = new Toast(need('toast'))
const help = new HelpOverlay(need('help'), REPO_URL)

const browser = new BodyBrowser(need('browser'), system, (body) => {
  select(body)
  goTo(body)
})

const minimapHost = need('minimap')
const minimap = new Minimap(minimapHost, system, (body) => {
  select(body)
  goTo(body)
})
minimap.show()

/**
 * Bound the info panel so it stops short of the orrery map in the same corner.
 *
 * Measured from real geometry rather than expressed in `vh`: viewport units do
 * not always equal the client height a panel is actually laid out against, and
 * being a few pixels out means long content (Saturn's ring table) disappears
 * under the map.
 */
function syncPanelBounds(): void {
  const viewportHeight = document.documentElement.clientHeight
  const shown = (el: HTMLElement): boolean =>
    el.offsetParent !== null && getComputedStyle(el).display !== 'none'

  // Right column: the info panel stops above the orrery map.
  const info = need('info')
  const available = minimap.visible
    ? minimapHost.getBoundingClientRect().top - 12
    : viewportHeight - 14
  info.style.maxHeight = `${Math.max(220, Math.round(available - 14))}px`

  // Left column: the body browser stops above the view panel. Both are fixed to
  // the same edge, so the browser's `bottom` has to clear the view panel's whole
  // height — and that height is content-dependent (it grows with every toggle
  // added), which is exactly why the hard-coded 176px in the stylesheet was 29px
  // short and the two overlapped.
  const browser = need('browser')
  const toggles = need('toggles')
  const clearance = shown(toggles)
    ? Math.round(viewportHeight - toggles.getBoundingClientRect().top + 12)
    : 14
  browser.style.bottom = `${clearance}px`
}

// Neither panel's height is final at startup, and both change later: the orrery
// caption wraps to a second line once the first frame fills it in, and the view
// panel grows whenever a toggle is added. Observe them rather than measuring
// once and trusting the result.
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => syncPanelBounds())
  observer.observe(minimapHost)
  observer.observe(need('toggles'))
}

const togglePanel = new TogglePanel(
  need('toggles'),
  [
    { label: 'labels', get: () => scene.toggles.labels !== 'none', set: (v) => (scene.toggles.labels = v ? 'major' : 'none') },
    { label: 'belts', get: () => scene.toggles.belts, set: (v) => (scene.toggles.belts = v) },
    { label: 'rings', get: () => scene.toggles.rings, set: (v) => (scene.toggles.rings = v) },
    { label: 'atmospheres', get: () => scene.toggles.atmospheres, set: (v) => (scene.toggles.atmospheres = v) },
    { label: 'Milky Way', get: () => scene.toggles.milkyway, set: (v) => (scene.toggles.milkyway = v) },
    { label: 'minor bodies', get: () => scene.toggles.minorBodies, set: (v) => (scene.toggles.minorBodies = v) },
    {
      label: 'orrery map',
      get: () => minimap.visible,
      set: (v) => {
        if (v) minimap.show()
        else minimap.hide()
        // Lets the info panel reclaim the corner the map was occupying.
        syncPanelBounds()
      },
    },
  ],
  {
    get: () => scene.toggles.orbits,
    set: (mode) => {
      scene.toggles.orbits = mode
      togglePanel.refresh()
    },
  },
  {
    get: () => scale.mode,
    set: (mode) => {
      scale.setMode(mode)
      togglePanel.refresh()
      toast.show(mode === 'true' ? 'True scale — 1:1' : 'Explore scale — bodies enlarged, distances compressed')
    },
  },
  REPO_URL,
)

// Second pass of the shared view: display state, now that the panels exist so
// their checkboxes and segmented buttons reflect what was restored.
if (shared.orbits) scene.toggles.orbits = shared.orbits
if (shared.labels) scene.toggles.labels = shared.labels
if (shared.toggles) {
  scene.toggles.belts = shared.toggles.belts
  scene.toggles.rings = shared.toggles.rings
  scene.toggles.atmospheres = shared.toggles.atmospheres
  scene.toggles.milkyway = shared.toggles.milkyway
  scene.toggles.minorBodies = shared.toggles.minorBodies
  if (shared.toggles.orrery) minimap.show()
  else minimap.hide()
  syncPanelBounds()
}
togglePanel.refresh()

select(selected)

// ---------------------------------------------------------------------------
// Selection and navigation
// ---------------------------------------------------------------------------

function select(body: SimBody): void {
  selected = body
  scene.setSelected(body)
  infoPanel.setBody(body, system)
  browser.setSelected(body)
}

function goTo(body: SimBody): void {
  camera.setFocus(body, { sunward: sunwardOf(body) })
  toast.show(`${body.name} — ${body.subtitle}`)
}

/** Frame the entire solar system from above. */
function frameEverything(): void {
  camera.setFocus(system.sun, { immediate: false })
  // Neptune's remapped orbit sets the useful extent.
  const neptune = system.byKey.get('neptune')
  const extent = neptune
    ? Math.hypot(neptune.scene.x, neptune.scene.y, neptune.scene.z)
    : (AU_KM * 30) / SCENE_UNIT_KM
  camera.frameSystem(system.sun, extent)
  toast.show('Whole system')
}

const PLANET_ORDER = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
]

function cyclePlanet(step: number): void {
  // Walk up to the planet that owns whatever is focused.
  const current = focused()
  const anchor = current.type === 'moon' ? (current.parent?.key ?? 'earth') : current.key
  const index = PLANET_ORDER.indexOf(anchor)
  const next = PLANET_ORDER[(index + step + PLANET_ORDER.length) % PLANET_ORDER.length]!
  const body = system.byKey.get(next)
  if (body) {
    select(body)
    goTo(body)
  }
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

let pointerDownAt = { x: 0, y: 0, t: 0 }

canvas.addEventListener('pointerdown', (ev) => {
  pointerDownAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }
})

canvas.addEventListener('pointerup', (ev) => {
  const moved = Math.hypot(ev.clientX - pointerDownAt.x, ev.clientY - pointerDownAt.y)
  const elapsed = performance.now() - pointerDownAt.t
  // Only treat it as a click if the pointer basically stayed put.
  if (moved > 6 || elapsed > 500) return
  const rect = canvas.getBoundingClientRect()
  const hit = scene.pick(ev.clientX - rect.left, ev.clientY - rect.top, system)
  if (hit) select(hit)
})

canvas.addEventListener('dblclick', (ev) => {
  const rect = canvas.getBoundingClientRect()
  const hit = scene.pick(ev.clientX - rect.left, ev.clientY - rect.top, system)
  if (hit) {
    select(hit)
    goTo(hit)
  }
})

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const ORBIT_MODES: OrbitMode[] = ['none', 'planets', 'all']
const LABEL_MODES: LabelMode[] = ['none', 'major', 'all']
const QUALITIES: Quality[] = ['low', 'medium', 'high']
let quality: Quality = 'high'

function typingInField(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node) return false
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable
}

window.addEventListener('keydown', (ev) => {
  if (typingInField(ev.target)) return

  const keys = camera.keys
  switch (ev.code) {
    case 'KeyW':
      keys.forward = true
      return
    case 'KeyS':
      keys.back = true
      return
    case 'KeyA':
      keys.left = true
      return
    case 'KeyD':
      keys.right = true
      return
    case 'KeyR':
      keys.up = true
      return
    case 'KeyF':
      keys.down = true
      return
    case 'KeyQ':
      keys.rollLeft = true
      return
    case 'KeyE':
      keys.rollRight = true
      return
    case 'ArrowLeft':
      keys.orbitLeft = true
      ev.preventDefault()
      return
    case 'ArrowRight':
      keys.orbitRight = true
      ev.preventDefault()
      return
    case 'ArrowUp':
      keys.orbitUp = true
      ev.preventDefault()
      return
    case 'ArrowDown':
      keys.orbitDown = true
      ev.preventDefault()
      return
    case 'Equal':
    case 'NumpadAdd':
      keys.zoomIn = true
      return
    case 'Minus':
    case 'NumpadSubtract':
      keys.zoomOut = true
      return
    default:
      break
  }

  if (ev.key === 'Shift') keys.boost = true
  if (ev.key === 'Alt') keys.precise = true

  // Single-shot actions.
  switch (ev.key) {
    case ' ':
      ev.preventDefault()
      time.togglePause()
      toast.show(time.paused ? 'Paused' : `Running — ${time.rateLabel}`)
      break
    case 'j':
    case 'J':
      time.setDirection(-1)
      time.setPaused(false)
      toast.show(`Reversed — ${time.rateLabel}`)
      break
    case 'l':
    case 'L':
      time.setDirection(1)
      time.setPaused(false)
      toast.show(`Forward — ${time.rateLabel}`)
      break
    case ']':
      time.faster()
      toast.show(time.rateLabel)
      break
    case '[':
      time.slower()
      toast.show(time.rateLabel)
      break
    case '.':
      time.stepOnePreset(1)
      break
    case ',':
      time.stepOnePreset(-1)
      break
    case 'n':
    case 'N':
      time.setNow()
      time.resetRate()
      toast.show('Now, real-time')
      break
    case 't':
    case 'T': {
      const mode = scale.toggle()
      togglePanel.refresh()
      toast.show(
        mode === 'true'
          ? 'True scale — 1:1, and mostly empty'
          : 'Explore scale — bodies enlarged, distances compressed',
      )
      break
    }
    case 'o':
    case 'O': {
      const next = ORBIT_MODES[(ORBIT_MODES.indexOf(scene.toggles.orbits) + 1) % ORBIT_MODES.length]!
      scene.toggles.orbits = next
      togglePanel.refresh()
      toast.show(`Orbits: ${next}`)
      break
    }
    case 'm':
    case 'M': {
      const next = LABEL_MODES[(LABEL_MODES.indexOf(scene.toggles.labels) + 1) % LABEL_MODES.length]!
      scene.toggles.labels = next
      togglePanel.refresh()
      toast.show(`Labels: ${next}`)
      break
    }
    case 'b':
    case 'B':
      scene.toggles.belts = !scene.toggles.belts
      togglePanel.refresh()
      toast.show(`Belts ${scene.toggles.belts ? 'on' : 'off'}`)
      break
    case 'k':
    case 'K':
      scene.toggles.rings = !scene.toggles.rings
      togglePanel.refresh()
      toast.show(`Rings ${scene.toggles.rings ? 'on' : 'off'}`)
      break
    case 'i':
    case 'I':
      scene.toggles.atmospheres = !scene.toggles.atmospheres
      togglePanel.refresh()
      toast.show(`Atmospheres ${scene.toggles.atmospheres ? 'on' : 'off'}`)
      break
    case 'p':
    case 'P':
      quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!
      scene.setQuality(quality)
      toast.show(`Quality: ${quality}`)
      break
    case 'v':
    case 'V': {
      const mode = camera.toggleMode()
      toast.show(mode === 'free' ? 'Free flight — WASD to fly, V to return' : 'Orbit camera')
      break
    }
    case 'c':
    case 'C':
      camera.lookAtFocus()
      break
    case 'g':
    case 'G':
      goTo(selected)
      break
    case '/':
      ev.preventDefault()
      browser.focusSearch()
      break
    case 'h':
    case 'H':
    case '?':
      help.toggle()
      break
    case 'Escape':
      help.hide()
      break
    case 'Home':
      frameEverything()
      break
    case 'Tab':
      ev.preventDefault()
      cyclePlanet(ev.shiftKey ? -1 : 1)
      break
    case '0':
      select(system.sun)
      goTo(system.sun)
      break
    default:
      if (/^[1-9]$/.test(ev.key)) {
        const key = PLANET_ORDER[Number(ev.key) - 1]
        const body = key ? system.byKey.get(key) : undefined
        if (body) {
          select(body)
          goTo(body)
        }
      }
      break
  }
})

window.addEventListener('keyup', (ev) => {
  const keys = camera.keys
  switch (ev.code) {
    case 'KeyW': keys.forward = false; break
    case 'KeyS': keys.back = false; break
    case 'KeyA': keys.left = false; break
    case 'KeyD': keys.right = false; break
    case 'KeyR': keys.up = false; break
    case 'KeyF': keys.down = false; break
    case 'KeyQ': keys.rollLeft = false; break
    case 'KeyE': keys.rollRight = false; break
    case 'ArrowLeft': keys.orbitLeft = false; break
    case 'ArrowRight': keys.orbitRight = false; break
    case 'ArrowUp': keys.orbitUp = false; break
    case 'ArrowDown': keys.orbitDown = false; break
    case 'Equal':
    case 'NumpadAdd': keys.zoomIn = false; break
    case 'Minus':
    case 'NumpadSubtract': keys.zoomOut = false; break
    default: break
  }
  if (ev.key === 'Shift') keys.boost = false
  if (ev.key === 'Alt') keys.precise = false
})

// Releasing focus should not leave a key stuck down.
window.addEventListener('blur', () => {
  camera.keys = {
    forward: false, back: false, left: false, right: false, up: false, down: false,
    rollLeft: false, rollRight: false, boost: false, precise: false,
    orbitLeft: false, orbitRight: false, orbitUp: false, orbitDown: false,
    zoomIn: false, zoomOut: false,
  }
})

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize(): void {
  const width = window.innerWidth
  const height = Math.max(1, window.innerHeight)
  camera.setAspect(width / height)
  scene.resize(width, height, camera.camera)
  syncPanelBounds()
}
window.addEventListener('resize', resize)
resize()

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

bootStatus.textContent = `${system.bodies.length} bodies · 459 satellites · 221 minor planets`

void library.preload([
  'milkyway.jpg',
  'sun.jpg',
  'earth_day.jpg',
  'earth_night.jpg',
  'earth_clouds.jpg',
  'moon.jpg',
  'mars.jpg',
  'jupiter.jpg',
  'saturn.jpg',
  'saturn_ring.png',
  'venus_surface.jpg',
  'mercury.jpg',
  'uranus.jpg',
  'neptune.jpg',
])

let booted = false
function finishBoot(): void {
  if (booted) return
  booted = true
  bootEl.classList.add('boot--done')
  setTimeout(() => {
    bootEl.style.display = 'none'
  }, 800)
  toast.show('Press H for the keyboard map')
}

library.onProgress((loaded, total) => {
  const fraction = total > 0 ? loaded / total : 1
  bootFill.style.width = `${Math.round(fraction * 100)}%`
  bootStatus.textContent = `loading imagery… ${loaded} / ${total}`
  if (loaded >= total) finishBoot()
})
// Never let a slow or missing texture keep the app behind the veil.
setTimeout(finishBoot, 9000)

// ---------------------------------------------------------------------------
// Scripting handle
// ---------------------------------------------------------------------------

/**
 * A small public handle on the running simulation.
 *
 * Exposed deliberately: it makes the app checkable from the console or a test
 * harness ("put the clock at the 2024 eclipse and tell me where the umbra
 * falls") without reaching into module internals, and it is genuinely useful
 * for anyone who wants to script a flythrough.
 */
declare global {
  interface Window {
    aphelion: {
      time: TimeController
      system: SolarSystem
      scale: ScaleModel
      scene: SceneView
      camera: CameraController
      /** The body the camera orbits. Change it with goTo(), never by assignment. */
      readonly focus: SimBody
      select: (key: string) => SimBody | null
      goTo: (key: string) => SimBody | null
      /** Sub-solar and sub-lunar longitude/latitude, for eclipse checks. */
      subPoint: (bodyKey: string, targetKey: string) => { lonDeg: number; latDeg: number } | null
    }
  }
}

window.aphelion = {
  time,
  system,
  scale,
  scene,
  camera,
  get focus() {
    return focused()
  },
  select: (key) => {
    const body = system.byKey.get(key)
    if (body) select(body)
    return body ?? null
  },
  goTo: (key) => {
    const body = system.byKey.get(key)
    if (body) {
      select(body)
      goTo(body)
    }
    return body ?? null
  },
  subPoint: (bodyKey, targetKey) => {
    const body = system.byKey.get(bodyKey)
    const target = system.byKey.get(targetKey)
    if (!body || !target) return null
    // Direction from the body to the target, in the body's rotating frame.
    const d = {
      x: target.helioKm.x - body.helioKm.x,
      y: target.helioKm.y - body.helioKm.y,
      z: target.helioKm.z - body.helioKm.z,
    }
    const o = body.orientation
    const x = o.x.x * d.x + o.x.y * d.y + o.x.z * d.z
    const y = o.y.x * d.x + o.y.y * d.y + o.y.z * d.z
    const z = o.z.x * d.x + o.z.y * d.y + o.z.z * d.z
    const r = Math.hypot(x, y, z) || 1
    return {
      lonDeg: (Math.atan2(y, x) * 180) / Math.PI,
      latDeg: (Math.asin(z / r) * 180) / Math.PI,
    }
  },
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now()
let elapsed = 0

/** Camera distance from the focused body, in true kilometres. */
let cameraDistanceKm = 0
/** The same distance expressed in radii of the focused body. */
let cameraRadii = 0

/**
 * Convert the camera's distance out of scene space into something physical.
 *
 * The raw scene distance is only kilometres in true-scale mode. Explore mode
 * enlarges bodies and compresses the space between them, so reporting scene
 * units as kilometres was simply wrong there — at one point the readout claimed
 * "5.6 AU" for a viewpoint that was nothing of the sort.
 *
 * Distance in *radii of the focused body* is exact in both modes, because a body
 * and its immediate surroundings scale uniformly. Multiplying back by the body's
 * true radius therefore gives an honest distance: the range at which the body
 * would appear this size at 1:1. In true-scale mode it reduces to the real
 * distance exactly.
 */
function updateCameraDistance(): void {
  const body = focused()
  const radius = body.sceneRadius
  cameraRadii = radius > 0 ? camera.currentDistance / radius : 0
  cameraDistanceKm = cameraRadii * body.radiusKm
}

// ---------------------------------------------------------------------------
// Shareable URL
// ---------------------------------------------------------------------------

const urlWriter = new UrlWriter(400)

/** Everything needed to reconstruct this view elsewhere. */
function currentSharedView(): SharedView {
  return {
    jdUtc: time.jdUtc,
    focusKey: focused().key,
    selectedKey: selected.key,
    scaleMode: scale.mode,
    // selectedRate, not rate: the latter reads 0 while paused, which would lose
    // the speed setting from the link.
    rate: time.selectedRate,
    paused: time.paused,
    azimuth: camera.orbitAzimuth,
    elevation: camera.orbitElevation,
    distanceRadii: cameraRadii,
    orbits: scene.toggles.orbits,
    labels: scene.toggles.labels,
    toggles: {
      belts: scene.toggles.belts,
      rings: scene.toggles.rings,
      atmospheres: scene.toggles.atmospheres,
      milkyway: scene.toggles.milkyway,
      minorBodies: scene.toggles.minorBodies,
      orrery: minimap.visible,
    },
  }
}

function frame(now: number): void {
  // Clamp so a backgrounded tab does not leap years on return.
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now
  elapsed += dt

  time.advance(dt)
  scale.update(dt)
  system.update(time.jdTT, scale)
  camera.update(dt)

  // Read the focus once per frame: the camera owns it, and the renderer, the
  // info panel and the mini-map must all agree on the same body.
  const current = focused()

  scene.update(system, scale, current, elapsed, dt)
  scene.render(camera.camera)

  timePanel.update()
  updateCameraDistance()
  infoPanel.update(system, current, cameraDistanceKm, cameraRadii)
  if (minimap.visible) minimap.update(current, selected)

  // Throttled inside; only touches history when the encoded view changes.
  urlWriter.sync(now, currentSharedView)

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// Surface the focus distance in the document title — handy when comparing
// scale modes side by side, and now the same number in both.
setInterval(() => {
  document.title = `Aphelion — ${focused().name} · ${formatDistance(cameraDistanceKm)}`
}, 1000)
