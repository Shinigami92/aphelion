/**
 * Aphelion — entry point.
 *
 * Owns the frame loop and wires the four independent pieces together:
 *
 *   core/time     the clock (ticks live, pausable, reversible, scrubbable)
 *   core/system   the physics (positions and orientations for ~690 bodies)
 *   render/scene  the picture
 *   ui/*          the panels
 *
 * The input bindings, the panel layout, the shared-link handling and the frame
 * governor live in app/; this file builds everything in order and runs the loop.
 *
 * The loop is strictly ordered: advance the clock, ease the scale, solve the
 * system, move the camera, push everything to the GPU, then update the DOM.
 */

import type { SimBody } from './core/system.ts';
import { startBoot } from './app/boot.ts';
import { CameraRange } from './app/camera-range.ts';
import { nearestSurfaceDistance } from './app/clearance.ts';
import { need } from './app/dom.ts';
import { FrameGovernor } from './app/governor.ts';
import { installKeyboard } from './app/keyboard.ts';
import { arrivalDirection, flyTo } from './app/navigation.ts';
import { PanelLayout } from './app/panel-layout.ts';
import { installPointerSelection } from './app/pointer.ts';
import { installScriptingHandle } from './app/scripting.ts';
import {
  applySharedCamera,
  applySharedClock,
  applySharedDisplay,
  sharedBodies,
  sharedViewReader,
} from './app/shared-view.ts';
import { TravelDust } from './app/travel-dust.ts';
import { createViewOptions } from './app/view-options.ts';
import { CameraController } from './controls/camera.ts';
import { ScaleModel } from './core/scale.ts';
import { SolarSystem } from './core/system.ts';
import { TimeController } from './core/time.ts';
import { parseView } from './core/url-parse.ts';
import { UrlWriter } from './core/url-writer.ts';
import { SceneView } from './render/scene.ts';
import { TextureLibrary } from './render/textures.ts';
import { registerServiceWorker } from './sw-register.ts';
import { Minimap } from './ui/minimap.ts';
import { BodyBrowser } from './ui/panels/body-browser.ts';
import { formatDistance } from './ui/panels/format.ts';
import { HelpOverlay } from './ui/panels/help-overlay.ts';
import { InfoPanel } from './ui/panels/info-panel.ts';
import { TimePanel } from './ui/panels/time-panel.ts';
import { Toast } from './ui/panels/toast.ts';

registerServiceWorker();

const canvas = need('viewport', HTMLCanvasElement);

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const time = new TimeController();
const scale = new ScaleModel();
const system = new SolarSystem();
const library = new TextureLibrary();

/**
 * A shared view, if the URL carries one.
 *
 * Applied in two passes. The clock and the scale mode have to land before the
 * first solve, because every position and radius downstream depends on them; the
 * camera angle and the view toggles need the panels to exist and so come later.
 */
const shared = parseView(window.location.search);
applySharedClock(shared, time, scale);

// Solve once before anything reads a radius or a position.
system.update(time.jdTT, scale);

const camera = new CameraController(window.innerWidth / Math.max(1, window.innerHeight));
const scene = new SceneView(canvas, library);
scene.setLabelHost(need('labels'));
scene.currentCamera = camera.camera;

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
const focused = (): SimBody => camera.focus ?? system.sun;

const { focus: initialFocus, selected: initialSelection } = sharedBodies(shared, system);
let selected: SimBody = initialSelection;

applySharedCamera(shared, camera, initialFocus, arrivalDirection(initialFocus));

scene.build(system);
scene.setSelected(selected);
scene.setQuality('high');
camera.attach(canvas);

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Canonical home for source, data provenance and licences. */
const REPO_URL = 'https://github.com/Shinigami92/aphelion';

const help = new HelpOverlay(need('help'), REPO_URL);
const timePanel = new TimePanel(need('time-panel'), time, () => {
  help.toggle();
});
const infoPanel = new InfoPanel(need('info'));
const toast = new Toast(need('toast'));

const browser = new BodyBrowser(
  need('browser'),
  system,
  (body) => {
    select(body);
    goTo(body);
  },
  () => scene.toggles.lagrange,
);

/**
 * The one way to turn the Lagrange points on and off.
 *
 * The switch owns both halves of the layer: the markers in the scene and the
 * rows in the body browser. Setting `scene.toggles.lagrange` directly is what
 * leaves the list offering forty places you cannot see, so the checkbox, the X
 * key and a restored link all come through here.
 */
function setLagrange(on: boolean): void {
  scene.toggles.lagrange = on;
  browser.refresh();
}

const minimap = new Minimap(need('minimap'), system, (body) => {
  select(body);
  goTo(body);
});

const togglePanel = createViewOptions(
  need('toggles'),
  { scene, scale, toast, setLagrange },
  REPO_URL,
);

const layout = new PanelLayout({ timePanel, browser, infoPanel, minimap, togglePanel });

// Second pass of the shared view: display state, now that the panels exist so
// their checkboxes and segmented buttons reflect what was restored.
applySharedDisplay(shared, scene, setLagrange);
togglePanel.refresh();

select(selected);

// ---------------------------------------------------------------------------
// Selection and navigation
// ---------------------------------------------------------------------------

function select(body: SimBody): void {
  selected = body;
  scene.setSelected(body);
  infoPanel.setBody(body);
  browser.setSelected(body);
}

function goTo(body: SimBody): void {
  flyTo(camera, toast, body);
}

installPointerSelection(canvas, (x, y) => scene.pick(x, y, system), select, goTo);

installKeyboard({
  time,
  scale,
  system,
  scene,
  camera,
  toast,
  help,
  focused,
  selected: () => selected,
  select,
  goTo,
  setLagrange,
  refreshViewOptions: () => {
    togglePanel.refresh();
  },
  focusSearch: () => {
    browser.focusSearch();
  },
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize(): void {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  camera.setAspect(width / height);
  scene.resize(width, height, camera.camera);
  layout.sync();
}
window.addEventListener('resize', resize);
resize();

startBoot(library, system, toast, () => layout.mobile);

installScriptingHandle({ time, system, scale, scene, camera, focused, select, goTo });

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
let elapsed = 0;

const governor = new FrameGovernor(time, scale, camera, scene);
governor.install(canvas);

const range = new CameraRange(camera, focused);

const urlWriter = new UrlWriter(400);
const currentSharedView = sharedViewReader({
  time,
  scale,
  camera,
  scene,
  focused,
  selected: () => selected,
  cameraRadii: () => range.radii,
});

const travelDust = new TravelDust(camera, scene, focused);

/** The orrery map is a schematic; it does not need to keep up with the scene. */
let lastMinimapAt = -Infinity;
const MINIMAP_INTERVAL_MS = 125;

function frame(now: number): void {
  requestAnimationFrame(frame);

  // Clamp so a backgrounded tab does not leap years on return.
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  const step = governor.tick(now, dt);
  if (step === null) {
    return;
  }
  elapsed += step;

  time.advance(step);
  scale.update(step);
  system.update(time.jdTT, scale);
  camera.setNearestSurface(nearestSurfaceDistance(camera, system, focused()));
  camera.update(step);

  // Read the focus once per frame: the camera owns it, and the renderer, the
  // info panel and the mini-map must all agree on the same body.
  const current = focused();

  scene.update(system, scale, current, elapsed, step);
  travelDust.update(step);
  scene.render(camera.camera);

  timePanel.update();
  range.update();
  infoPanel.update(system, current, range.km, range.radii);

  // A folded panel keeps its canvas laid out behind the header, so the collapsed
  // flag — not the element's size — is what says the drawing would be unseen.
  if (!layout.minimapPanel.collapsed && now - lastMinimapAt >= MINIMAP_INTERVAL_MS) {
    lastMinimapAt = now;
    minimap.update(current, selected, scene.toggles.lagrange);
  }

  // Throttled inside; only touches history when the encoded view changes.
  urlWriter.sync(now, currentSharedView);
}

requestAnimationFrame(frame);

// Surface the focus distance in the document title — handy when comparing
// scale modes side by side, and now the same number in both.
setInterval(() => {
  document.title = `Aphelion — ${focused().name} · ${formatDistance(range.km)}`;
}, 1000);
