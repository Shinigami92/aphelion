/** Which body a click on the canvas means. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { SceneToggles } from './types.ts';
import type { BodyVisual } from './visual.ts';
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { SHAPE_APPARENT_PX } from './constants.ts';

/** A body reduced to what the hit test needs: where it is and how big. */
interface PickPoint {
  /** CSS pixels from the left of the canvas. */
  x: number;
  /** CSS pixels from the top of the canvas. */
  y: number;
  /** Scene units from the camera. */
  distance: number;
  /** Apparent radius in pixels; 0 for the fixed-size Lagrange markers. */
  apparent: number;
}

/** A body the click could mean, and where it landed on screen. */
interface Candidate {
  body: SimBody;
  point: PickPoint;
}

/** What the hit test needs from the scene. */
export interface PickContext {
  readonly state: FrameState;
  readonly sunVisual: BodyVisual | null;
  readonly visuals: ReadonlyMap<string, BodyVisual>;
  readonly promoted: ReadonlyMap<string, BodyVisual>;
  readonly lagrangeBodies: ReadonlyArray<SimBody>;
}

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();

/**
 * Is anything actually drawn for this body right now?
 *
 * An invisible thing that swallows clicks meant for what is behind it is
 * indistinguishable from a broken hit test. This was written for the Lagrange
 * reticles and applies just as well to everything else: a moon whose mesh has
 * been culled for being sub-pixel is drawn nowhere at all, and with the minor
 * bodies toggled off neither is a rock.
 *
 * The Sun, the planets and the dwarfs are exempt. They are the landmarks of
 * the map — they carry a label at any size, they are the destinations the
 * whole UI is built around, and one of them is always what a click on a
 * distant speck of a system was reaching for.
 */
function isAimable(body: SimBody, visual: BodyVisual | undefined, toggles: SceneToggles): boolean {
  if (body.type === 'star' || body.type === 'planet' || body.type === 'dwarf') {
    return true;
  }
  if (body.type === 'lagrange') {
    return toggles.lagrange;
  }
  if (visual) {
    return visual.group.visible;
  }
  return toggles.minorBodies;
}

/** Where a body lands on screen, or null if it is not in front of the camera. */
function projectForPick(
  body: SimBody,
  camera: PerspectiveCamera,
  state: FrameState,
): PickPoint | null {
  tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(state.origin);
  tmpVec2.copy(tmpVec).project(camera);
  if (tmpVec2.z < -1 || tmpVec2.z > 1) {
    return null;
  }
  const distance = camera.position.distanceTo(tmpVec);
  return {
    x: (tmpVec2.x * 0.5 + 0.5) * state.viewport.x,
    y: (-tmpVec2.y * 0.5 + 0.5) * state.viewport.y,
    distance,
    // A marker is exactly as big as it is drawn. Using its nominal radius
    // here would let a Lagrange point standing close to the camera claim half
    // the screen while showing a 13-pixel reticle.
    apparent:
      body.type === 'lagrange'
        ? 0
        : (body.sceneRadius / Math.max(distance, 1e-9)) * state.viewport.y,
  };
}

/**
 * Every aimable body within reach of the cursor, and the distance of the
 * nearest solid disc under it.
 */
function collectReachable(
  clientX: number,
  clientY: number,
  system: SolarSystem,
  tolerance: number,
  camera: PerspectiveCamera,
  ctx: PickContext,
): { reachable: Candidate[]; occluderDistance: number } {
  // Lagrange points are only worth walking while their layer is drawn.
  const groups = ctx.state.toggles.lagrange ? [system.bodies, ctx.lagrangeBodies] : [system.bodies];

  const reachable: Candidate[] = [];
  // Nearest solid disc lying under the cursor. Whatever is drawn there hides
  // everything behind it, and the depth buffer already agrees — a sprite
  // eclipsed by a planet is not on screen to be clicked.
  let occluderDistance = Infinity;

  for (const group of groups) {
    for (const body of group) {
      // The Sun keeps its visual outside the map, and it is the one disc big
      // enough that things routinely pass behind it.
      const visual =
        body.type === 'star'
          ? (ctx.sunVisual ?? undefined)
          : (ctx.visuals.get(body.key) ?? ctx.promoted.get(body.key));
      if (!isAimable(body, visual, ctx.state.toggles)) {
        continue;
      }
      const point = projectForPick(body, camera, ctx.state);
      if (!point) {
        continue;
      }
      const pixelDistance = Math.hypot(point.x - clientX, point.y - clientY);

      // Only a drawn sphere blocks anything. A sprite is a pixel of glow.
      if (visual?.group.visible === true && pixelDistance <= point.apparent) {
        occluderDistance = Math.min(occluderDistance, point.distance);
      }
      // Clicking anywhere on a large body should select it.
      if (pixelDistance <= Math.max(tolerance, point.apparent)) {
        reachable.push({ body, point });
      }
    }
  }
  return { reachable, occluderDistance };
}

/**
 * Walk up to the body a click in this cluster actually means.
 *
 * A primary's aim disc is opaque to its own shapeless satellites: while the
 * cursor is inside the reach of a planet, no speck orbiting that planet can
 * outrank it. From far away that disc is the whole system, so every click
 * near the dot lands on the planet, which is the point. Chain it and a click
 * on an unresolved inner planet resolves through to the Sun for the same
 * reason.
 *
 * Both conditions are doing work. Without the shape test a moon transiting
 * from close range — a real disc, unmistakably aimed at — would be swallowed
 * by the planet behind it. Without the reach test the moons of a planet you
 * are standing next to would be, and by the time a moon is drawn clear of its
 * planet you can point at it. What remains unreachable is a shapeless moon
 * against its own primary's disc, which is right twice over: at one pixel
 * across it cannot be aimed at, and it is either lost against the lit surface
 * or hidden behind it.
 */
function clusterPrimary(
  body: SimBody,
  point: PickPoint,
  camera: PerspectiveCamera,
  clientX: number,
  clientY: number,
  tolerance: number,
  state: FrameState,
): Candidate {
  let current = body;
  let currentPoint = point;
  while (current.parent && currentPoint.apparent < SHAPE_APPARENT_PX) {
    const parentPoint = projectForPick(current.parent, camera, state);
    if (!parentPoint) {
      break;
    }
    const reach = Math.max(tolerance, parentPoint.apparent);
    if (Math.hypot(parentPoint.x - clientX, parentPoint.y - clientY) > reach) {
      break;
    }
    current = current.parent;
    currentPoint = parentPoint;
  }
  return { body: current, point: currentPoint };
}

/**
 * Nearest body to a screen position, within a pixel tolerance.
 *
 * Screen-space proximity rather than ray casting, so point-rendered minor
 * bodies are just as clickable as full spheres.
 *
 * Three rules keep the answer to the one the user meant, all of them the same
 * principle — a click can only mean something you can see and aim at. Nothing
 * undrawn is a candidate (`isAimable`); nothing behind a solid disc under the
 * cursor is either; and anything drawn as a point inside its primary's aim
 * radius resolves to that primary (`clusterPrimary`).
 *
 * The numbers behind them, measured from the Moon at 2026-08-15T18:30Z:
 * Saturn is a 1.5-pixel disc buried in the sprites of its 291 moons, which
 * spread forty pixels around it. A click one pixel off centre used to select
 * Polydeuces, a 1.3 km rock, and only Neptune's exact centre pixel avoided
 * Hippocamp, Nereid or an L1 reticle. Standing at Saturn instead, a click on
 * Mimas returned a small body hidden behind the planet.
 */
export function pickBody(
  clientX: number,
  clientY: number,
  system: SolarSystem,
  tolerance: number,
  ctx: PickContext,
): SimBody | null {
  const camera = ctx.state.camera;
  if (!camera) {
    return null;
  }

  const { reachable, occluderDistance } = collectReachable(
    clientX,
    clientY,
    system,
    tolerance,
    camera,
    ctx,
  );

  let best: SimBody | null = null;
  let bestScore = Infinity;
  for (const { body, point } of reachable) {
    // Compared against the occluder's centre rather than its near surface, so
    // a moon skimming the limb stays clickable and only what is decisively
    // round the back is dropped.
    if (point.distance > occluderDistance) {
      continue;
    }

    // What the click means may be the primary rather than the speck that
    // caught it — and then it is scored from the primary's own position, not
    // the speck's.
    const target = clusterPrimary(body, point, camera, clientX, clientY, tolerance, ctx.state);
    // Prefer whatever is closest to the cursor, breaking ties toward the
    // nearer body so a moon in front of its planet wins.
    const score =
      Math.hypot(target.point.x - clientX, target.point.y - clientY) -
      Math.min(target.point.apparent, 40) * 0.5 +
      Math.log10(target.point.distance + 10) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = target.body;
    }
  }
  return best;
}
