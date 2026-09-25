/** Restoring a view from a shared link, and describing the current one for the next link. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SharedView } from '../core/url-state.ts';
import type { SceneView } from '../render/scene.ts';
import { rateToPreset } from '../core/time.ts';

/**
 * First pass: the clock and the scale mode, which have to land before the first
 * solve because every position and radius downstream depends on them.
 */
export function applySharedClock(
  shared: Partial<SharedView>,
  time: TimeController,
  scale: ScaleModel,
): void {
  if (shared.jdUtc !== undefined) {
    time.setJdUtc(shared.jdUtc);
  }
  if (shared.rate !== undefined) {
    const { index, direction } = rateToPreset(shared.rate);
    time.setRateIndex(index);
    time.setDirection(direction);
  }
  if (shared.paused === true) {
    time.setPaused(true);
  }

  scale.setMode(shared.scaleMode ?? 'explore');
  scale.snap();
}

/** The bodies a link names: what the camera starts at, and what is selected. Earth if none. */
export function sharedBodies(
  shared: Partial<SharedView>,
  system: SolarSystem,
): { focus: SimBody; selected: SimBody } {
  const focus =
    (shared.focusKey !== undefined && shared.focusKey !== ''
      ? system.byKey.get(shared.focusKey)
      : null) ?? system.byKey.get('earth')!;
  const selected =
    (shared.selectedKey !== undefined && shared.selectedKey !== null && shared.selectedKey !== ''
      ? system.byKey.get(shared.selectedKey)
      : null) ?? focus;
  return { focus, selected };
}

/**
 * The camera: which body it starts at, from which angle and range, and whether
 * it was flying free when the link was taken.
 */
export function applySharedCamera(
  shared: Partial<SharedView>,
  camera: CameraController,
  initialFocus: SimBody,
  arriveFrom: { x: number; y: number; z: number } | undefined,
): void {
  camera.setFocus(initialFocus, { immediate: true, arriveFrom });
  // A shared link carries an explicit angle and range; without one, keep the
  // daylit-side default setFocus just chose.
  camera.restoreView({
    azimuth: shared.azimuth,
    elevation: shared.elevation,
    distanceRadii: shared.distanceRadii,
  });
  // ...and then back out of orbit mode if the link says the camera was flying.
  // Without a position there is nothing to restore, so the link falls back to the
  // orbit view rather than dropping the camera at the origin.
  if (shared.cameraMode === 'free' && shared.freePosition) {
    camera.restoreFreeView({
      position: shared.freePosition,
      orientation: shared.freeOrientation ?? null,
    });
  }
}

/**
 * Second pass: display state, once the panels exist so their checkboxes and
 * segmented buttons reflect what was restored.
 */
export function applySharedDisplay(
  shared: Partial<SharedView>,
  scene: SceneView,
  setLagrange: (on: boolean) => void,
): void {
  if (shared.orbits) {
    scene.toggles.orbits = shared.orbits;
  }
  if (shared.labels) {
    scene.toggles.labels = shared.labels;
  }
  if (shared.toggles) {
    scene.toggles.belts = shared.toggles.belts;
    scene.toggles.rings = shared.toggles.rings;
    scene.toggles.atmospheres = shared.toggles.atmospheres;
    scene.toggles.milkyway = shared.toggles.milkyway;
    scene.toggles.minorBodies = shared.toggles.minorBodies;
    setLagrange(shared.toggles.lagrange);
  }
}

/** Everything needed to reconstruct this view elsewhere, read fresh on each call. */
export function sharedViewReader(deps: {
  time: TimeController;
  scale: ScaleModel;
  camera: CameraController;
  scene: SceneView;
  focused: () => SimBody;
  selected: () => SimBody;
  cameraRadii: () => number;
}): () => SharedView {
  const { time, scale, camera, scene } = deps;
  return (): SharedView => {
    return {
      jdUtc: time.jdUtc,
      focusKey: deps.focused().key,
      selectedKey: deps.selected().key,
      scaleMode: scale.mode,
      // selectedRate, not rate: the latter reads 0 while paused, which would lose
      // the speed setting from the link.
      rate: time.selectedRate,
      paused: time.paused,
      azimuth: camera.orbitAzimuth,
      elevation: camera.orbitElevation,
      distanceRadii: deps.cameraRadii(),
      cameraMode: camera.mode,
      // Evaluated once here rather than twice below; null in orbit mode, where
      // azimuth/elevation/distance already say everything.
      ...(() => {
        const free = camera.freeView();
        return { freePosition: free?.position ?? null, freeOrientation: free?.orientation ?? null };
      })(),
      orbits: scene.toggles.orbits,
      labels: scene.toggles.labels,
      toggles: {
        belts: scene.toggles.belts,
        rings: scene.toggles.rings,
        atmospheres: scene.toggles.atmospheres,
        milkyway: scene.toggles.milkyway,
        minorBodies: scene.toggles.minorBodies,
        lagrange: scene.toggles.lagrange,
      },
    };
  };
}
