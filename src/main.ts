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

import { Vector3 } from 'three'
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
import { makeCollapsible } from './ui/collapse.ts'
import { installMobileShell } from './ui/mobile.ts'

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
// ...and then back out of orbit mode if the link says the camera was flying.
// Without a position there is nothing to restore, so the link falls back to the
// orbit view rather than dropping the camera at the origin.
if (shared.cameraMode === 'free' && shared.freePosition) {
  camera.restoreFreeView({
    position: shared.freePosition,
    orientation: shared.freeOrientation ?? null,
  })
}

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
 * under the map. Does nothing under the phone layout, which places its panels
 * from the stylesheet instead.
 */

/**
 * Whether the phone shell is in charge of panel placement.
 *
 * A plain flag rather than a reference to the shell: it calls back while it is
 * still being constructed, so reading its binding from here would be a temporal
 * dead zone.
 */
let mobileLayout = false

function syncPanelBounds(): void {
  // The phone layout positions these panels from the stylesheet, and inline
  // styles would win over it. Hand them back rather than merely skipping, or a
  // rotation from desktop widths leaves a stale `bottom` pinning a sheet.
  if (mobileLayout) {
    for (const id of ['browser', 'info']) {
      const panel = need(id)
      panel.style.top = ''
      panel.style.bottom = ''
      panel.style.maxHeight = ''
      panel.style.height = ''
    }
    return
  }

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

  // ...and starts below the time panel, for the same reason in the other
  // direction. The stylesheet's 186px assumes a fully expanded clock, so
  // collapsing it used to leave the browser stranded with a band of empty space
  // above it while the other two edges of the column tracked their neighbours.
  const timePanel = need('time-panel')
  browser.style.top = shown(timePanel)
    ? `${Math.round(timePanel.getBoundingClientRect().bottom + 12)}px`
    : '14px'
}

// No panel's height is final at startup, and all of them change later: the
// orrery caption wraps to a second line once the first frame fills it in, the
// view panel grows whenever a toggle is added, and any of them can now be
// collapsed. Observe them rather than measuring once and trusting the result.
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => syncPanelBounds())
  observer.observe(minimapHost)
  observer.observe(need('toggles'))
  observer.observe(need('time-panel'))
}

const togglePanel = new TogglePanel(
  need('toggles'),
  [
    { label: 'labels', get: () => scene.toggles.labels !== 'none', set: (v) => (scene.toggles.labels = v ? 'major' : 'none') },
    { label: 'belts', get: () => scene.toggles.belts, set: (v) => (scene.toggles.belts = v) },
    { label: 'rings', get: () => scene.toggles.rings, set: (v) => (scene.toggles.rings = v) },
    { label: 'atmospheres', get: () => scene.toggles.atmospheres, set: (v) => (scene.toggles.atmospheres = v) },
    // One switch for the whole backdrop — the deep sky and the catalogue stars
    // are two layers of one thing. The URL parameter keeps its old name so
    // links shared before the stars existed still resolve.
    { label: 'stars', get: () => scene.toggles.milkyway, set: (v) => (scene.toggles.milkyway = v) },
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

// Every panel folds down to its own header, so a crowded screen can be cleared
// without losing track of what is selected or what the clock reads. Collapsing
// the view panel changes its height, which the ResizeObserver above already
// watches, so the browser panel's lower bound follows on its own.
const collapsibles = [
  makeCollapsible(need('time-panel'), timePanel.head, timePanel.body, 'the time controls'),
  makeCollapsible(need('browser'), browser.head, browser.body, 'the body browser'),
  makeCollapsible(need('info'), infoPanel.head, infoPanel.body, 'the body details'),
  makeCollapsible(minimapHost, minimap.head, minimap.body, 'the orrery map'),
  makeCollapsible(need('toggles'), togglePanel.head, togglePanel.body, 'the view options'),
]

/**
 * The phone layout: the clock docks across the top and the other four panels
 * become bottom sheets driven by a tab bar. The panels themselves are re-used,
 * so there is no second implementation of the browser or the info readouts.
 */
installMobileShell(
  need('app'),
  [
    { id: 'bodies', label: 'Bodies', panel: need('browser') },
    { id: 'info', label: 'Info', panel: need('info') },
    { id: 'view', label: 'View', panel: need('toggles') },
    {
      id: 'orrery',
      label: 'Orrery',
      panel: minimapHost,
      // The map only draws while it believes itself visible, and on a phone the
      // tab is the way you ask for it — so opening the sheet overrides the view
      // toggle rather than showing an empty box. Its canvas re-sizes itself on
      // the next frame.
      onShow: () => minimap.show(),
    },
  ],
  (mobile) => {
    mobileLayout = mobile
    if (mobile) {
      // A panel left collapsed on desktop carries an inline height that would
      // fight the sheet's own sizing, so every panel starts the phone layout
      // open. The chevrons are hidden there anyway.
      for (const panel of collapsibles) if (panel.collapsed) panel.toggle()
    }
    syncPanelBounds()
  },
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
  camera.flyTo(body, { sunward: sunwardOf(body) })
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

/** Where and when the last tap landed, for reconstructing a double-tap. */
let lastTapAt = { x: 0, y: 0, t: 0 }

canvas.addEventListener('pointerup', (ev) => {
  const moved = Math.hypot(ev.clientX - pointerDownAt.x, ev.clientY - pointerDownAt.y)
  const elapsed = performance.now() - pointerDownAt.t
  // Only treat it as a click if the pointer basically stayed put.
  if (moved > 6 || elapsed > 500) return
  const rect = canvas.getBoundingClientRect()
  const hit = scene.pick(ev.clientX - rect.left, ev.clientY - rect.top, system)
  if (hit) select(hit)

  // Double-tap to fly to a body. A mouse keeps the native `dblclick` below;
  // touch does not raise one dependably, so it is reconstructed here — with a
  // looser radius than the 6px tap threshold, because two taps from the same
  // finger rarely land on the same pixel.
  if (ev.pointerType === 'mouse') return
  const now = performance.now()
  const nearLast = Math.hypot(ev.clientX - lastTapAt.x, ev.clientY - lastTapAt.y) < 28
  if (nearLast && now - lastTapAt.t < 320) {
    if (hit) goTo(hit)
    // Reset rather than record, so a third tap does not chain into a second
    // flight.
    lastTapAt = { x: 0, y: 0, t: 0 }
  } else {
    lastTapAt = { x: ev.clientX, y: ev.clientY, t: now }
  }
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

/** Keys that mean "I am driving now", which cancels a cinematic approach. */
const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract',
])

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

  // Any movement key takes the controls back mid-flight, the same way a drag
  // does. Selection and display keys are left alone so pressing `M` during an
  // approach does not abort it.
  if (MOVEMENT_KEYS.has(ev.code)) camera.cancelFlight()

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
      // Only reachable from a keyboard in the first place, so naming keys here
      // is safe — but it is the sort of message to re-read if free flight ever
      // gets a touch affordance.
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
  'sky_milkyway.jpg',
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
  // The boot hint has to name something the reader can actually do: there is no
  // H to press on a phone, and the "?" chip is the only route to the reference
  // either way.
  toast.show(mobileLayout ? 'Tap ? for gestures and credits' : 'Press H for the keyboard map')
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

// ---------------------------------------------------------------------------
// Frame governor
// ---------------------------------------------------------------------------

/**
 * How often we actually redraw.
 *
 * The scene is never GPU-bound — it holds the vsync ceiling even at Retina
 * resolution with bloom, atmospheres and 75,000 belt points. The cost is that it
 * was drawing *every* frame the display offered, which on a 120 Hz panel meant
 * 120 full-quality renders a second whether or not anything had changed. Sitting
 * still with the clock at one second per second, consecutive frames are
 * identical, and all that work does is heat the machine and compete with
 * anything else wanting the GPU — a video call, for instance.
 *
 * So: 60 fps while something is actually happening, 10 while nothing is. Input
 * is checked before the throttle, so the first frame after you touch anything is
 * never delayed and the app stays responsive.
 */
const ACTIVE_FPS = 60
const IDLE_FPS = 10
/** Keep drawing at full rate for this long after the last input. */
const ACTIVE_LINGER_MS = 900
/**
 * Above this time rate the scene visibly moves on its own, so idling would look
 * like stutter rather than stillness. One hour per second moves Earth about
 0.04 degrees along its orbit per frame at 10 fps.
 */
const MOVING_RATE = 3600

let lastRenderAt = -Infinity
let pendingDt = 0
let lastInteractionAt = performance.now()
let wasChanging = true

/** Anything that should wake the renderer up. */
function markActive(): void {
  lastInteractionAt = performance.now()
}

function sceneIsChanging(now: number): boolean {
  if (now - lastInteractionAt < ACTIVE_LINGER_MS) return true
  if (now - camera.lastInputAt < ACTIVE_LINGER_MS) return true
  if (scale.isTransitioning || camera.isSettling) return true
  if (!time.paused && Math.abs(time.selectedRate) >= MOVING_RATE) return true
  // Ring particles tumble and shear at any running rate, including the slowest,
  // where no planet moves enough to wake the renderer on its own.
  if (!time.paused && scene.ringParticlesActive) return true
  return false
}

// Pointer and wheel events reach the camera, but the governor needs to know
// about them too, and about the ones the camera never sees. Pointer-down is
// window-wide so that clicking a checkbox or a body in the sidebar wakes the
// renderer just as readily as dragging the sky; drag and zoom stay on the canvas
// so that merely sweeping the cursor across a panel does not.
window.addEventListener('pointerdown', markActive, { passive: true })
window.addEventListener('keydown', markActive)
window.addEventListener('resize', markActive)
canvas.addEventListener('pointermove', markActive, { passive: true })
canvas.addEventListener('wheel', markActive, { passive: true })

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
    cameraMode: camera.mode,
    // Evaluated once here rather than twice below; null in orbit mode, where
    // azimuth/elevation/distance already say everything.
    ...(() => {
      const free = camera.freeView()
      return { freePosition: free?.position ?? null, freeOrientation: free?.orientation ?? null }
    })(),
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

/**
 * Clearance from the camera to the nearest body's surface, in scene units.
 *
 * Free flight scales its speed by this, which is what stops it from crossing a
 * planet in a single frame. Computed here rather than in the controller because
 * this is what holds the system; 687 distance checks a frame is nothing beside
 * the solve that just ran.
 *
 * Everything is measured in the render frame, where the focused body sits at
 * the origin — the same frame the camera's position is expressed in.
 */
function nearestSurfaceDistance(): number {
  const camPos = camera.camera.position
  // `body.scene` is absolute; the renderer applies the floating origin by
  // shifting the whole world group, so the camera's position is relative to the
  // focus. Subtracting the focus is what puts both in the same frame — without
  // it the Sun, which sits near the absolute origin, reads as a few hundred
  // units away from a camera parked at Earth, and free flight refuses to move.
  const origin = focused().scene
  let nearest = Infinity
  for (const body of system.bodies) {
    const dx = body.scene.x - origin.x - camPos.x
    const dy = body.scene.y - origin.y - camPos.y
    const dz = body.scene.z - origin.z - camPos.z
    const clearance = Math.hypot(dx, dy, dz) - body.sceneRadius
    if (clearance < nearest) nearest = clearance
  }
  // Reported unclamped: a negative value means the camera is inside a body, and
  // the controller needs to know that to let it fly back out rather than
  // damping it to a standstill.
  return nearest
}

/**
 * Feed the dust field the camera's actual velocity.
 *
 * Measured from the position delta rather than asked of the controller, because
 * only the delta accounts for every way the camera can move — a cinematic
 * flight, free flight, a drag, or the focus itself travelling. It has to be
 * taken in *absolute* scene space: relative to the floating origin the camera
 * barely moves during a flight, since the world slides underneath it.
 */
const lastCameraWorld = new Vector3()
let haveLastCameraWorld = false
const cameraVelocity = new Vector3()
const cameraWorld = new Vector3()

function updateTravelDust(dt: number): void {
  const origin = focused().scene
  cameraWorld.set(
    camera.camera.position.x + origin.x,
    camera.camera.position.y + origin.y,
    camera.camera.position.z + origin.z,
  )

  if (haveLastCameraWorld && dt > 0) {
    cameraVelocity.subVectors(cameraWorld, lastCameraWorld).divideScalar(dt)
  } else {
    cameraVelocity.set(0, 0, 0)
  }
  lastCameraWorld.copy(cameraWorld)
  haveLastCameraWorld = true

  // Only a cinematic flight or genuine free flight should raise dust; drifting
  // with a body you are orbiting should not, or the field never switches off.
  const intensity = camera.travelling > 0 ? camera.travelling : freeFlightIntensity()
  scene.updateDust(camera.camera.position, cameraVelocity, dt, intensity)
}

/** How hard free flight is being driven, 0..1, for the dust. */
function freeFlightIntensity(): number {
  if (camera.mode !== 'free') return 0
  const k = camera.keys
  const moving = k.forward || k.back || k.left || k.right || k.up || k.down
  if (!moving) return 0
  return k.boost ? 1 : 0.65
}

/** The orrery map is a schematic; it does not need to keep up with the scene. */
let lastMinimapAt = -Infinity
const MINIMAP_INTERVAL_MS = 125

function frame(now: number): void {
  requestAnimationFrame(frame)

  // Clamp so a backgrounded tab does not leap years on return.
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now

  // Accumulate real time even on frames we skip, so the clock stays exact and
  // every easing term still receives the true elapsed interval.
  pendingDt += dt

  const changing = sceneIsChanging(now)
  // Waking from idle draws on the very next display frame instead of waiting out
  // an active-rate interval, so touching anything responds immediately rather
  // than up to 17 ms later.
  if (changing && !wasChanging) lastRenderAt = -Infinity
  wasChanging = changing

  const interval = 1000 / (changing ? ACTIVE_FPS : IDLE_FPS)
  // Half a millisecond of slack, or a 60 fps target quietly becomes 30 on a
  // 120 Hz display when a frame lands a hair early.
  if (now - lastRenderAt < interval - 0.5) return
  lastRenderAt = now

  const step = pendingDt
  pendingDt = 0
  elapsed += step

  time.advance(step)
  scale.update(step)
  system.update(time.jdTT, scale)
  camera.setNearestSurface(nearestSurfaceDistance())
  camera.update(step)

  // Read the focus once per frame: the camera owns it, and the renderer, the
  // info panel and the mini-map must all agree on the same body.
  const current = focused()

  scene.update(system, scale, current, elapsed, step)
  updateTravelDust(step)
  scene.render(camera.camera)

  timePanel.update()
  updateCameraDistance()
  infoPanel.update(system, current, cameraDistanceKm, cameraRadii)

  if (minimap.visible && now - lastMinimapAt >= MINIMAP_INTERVAL_MS) {
    lastMinimapAt = now
    minimap.update(current, selected)
  }

  // Throttled inside; only touches history when the encoded view changes.
  urlWriter.sync(now, currentSharedView)
}

requestAnimationFrame(frame)

// Surface the focus distance in the document title — handy when comparing
// scale modes side by side, and now the same number in both.
setInterval(() => {
  document.title = `Aphelion — ${focused().name} · ${formatDistance(cameraDistanceKm)}`
}, 1000)
