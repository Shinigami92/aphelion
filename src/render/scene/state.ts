/**
 * The per-frame values every layer of the scene reads.
 *
 * One instance, owned by `SceneView` and handed to each layer by reference, so
 * there is exactly one copy of the camera, the focus and the selection for the
 * layers to agree on. `SceneView` writes it; the layers only read it, except
 * for `proceduralBudget`, which the body visuals spend.
 */

import type { SimBody } from '../../core/system.ts';
import type { Quality, SceneToggles } from './types.ts';
import type { PerspectiveCamera } from 'three';
import { Vector2, Vector3 } from 'three';

export class FrameState {
  /** Render-space origin: the focused body's scene position. */
  readonly origin = new Vector3();
  /** The Sun in render space. */
  readonly sunRender = new Vector3();
  /** Canvas size in CSS pixels. */
  readonly viewport = new Vector2(1, 1);

  toggles: SceneToggles = {
    orbits: 'planets',
    labels: 'major',
    belts: true,
    rings: true,
    atmospheres: true,
    milkyway: true,
    minorBodies: true,
    lagrange: true,
  };

  quality: Quality = 'high';

  selected: SimBody | null = null;

  /**
   * Per-frame cache of the focused body, refreshed from the argument to
   * `SceneView.update()`. The camera owns the focus; this is a read-only copy.
   */
  focus: SimBody | null = null;

  /** Camera used for rendering; set by the app each frame. */
  camera: PerspectiveCamera | null = null;

  /**
   * Days since J2000 of the frame being drawn.
   *
   * Anything the *simulation* clock drives has to read this and not a wall
   * clock, or it desynchronises the moment time is paused, scrubbed or run
   * backwards — and the whole point of a cloud deck that moves is that it is
   * showing you where the clouds were at the date on screen.
   */
  days = 0;

  /** The renderer's pixel ratio, sampled once per frame. */
  pixelRatio = 1;

  /** Procedural textures allowed to be generated this frame. */
  proceduralBudget = 0;
}
