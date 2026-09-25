/** Minor bodies promoted from a point to a real sphere as the camera nears them. */

import type { ScaleModel } from '../../core/scale.ts';
import type { SimBody } from '../../core/system.ts';
import type { TextureLibrary } from '../textures.ts';
import type { VisualContext } from './body-visual-update.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual, PromotionSlot } from './visual.ts';
import type { BufferGeometry } from 'three';
import { Group, Mesh, Vector3 } from 'three';
import { RELIEF_EXAGGERATION } from '../../data/bodies/relief.ts';
import { reliefFor } from '../../data/generated/relief.ts';
import { createBodyMaterial } from '../materials/body.ts';
import { solidTexture } from '../procedural.ts';
import { whenLoaded } from '../textures.ts';
import { updateBodyVisual } from './body-visual-update.ts';
import { SHAPE_APPARENT_PX } from './constants.ts';

/** Maximum minor bodies promoted to real geometry at once. */
const PROMOTION_SLOTS = 6;

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpVec = new Vector3();

export class PromotionLayer {
  /** Minor bodies currently drawn as spheres, by key. */
  readonly promoted = new Map<string, BodyVisual>();
  private promotionPool: PromotionSlot[] = [];

  constructor(
    private readonly state: FrameState,
    private readonly library: TextureLibrary,
  ) {}

  build(world: Group, lodGeometries: ReadonlyArray<BufferGeometry>): void {
    for (let i = 0; i < PROMOTION_SLOTS; i++) {
      const group = new Group();
      const material = createBodyMaterial({ map: solidTexture(0x808080) });
      const mesh = new Mesh(lodGeometries[1], material);
      group.add(mesh);
      group.visible = false;
      world.add(group);
      this.promotionPool.push({
        body: null,
        group,
        mesh,
        material,
        clouds: null,
        cloudMaterial: null,
        cloudDrift: 0,
        atmosphere: null,
        atmosphereMaterial: null,
        rings: [],
        lod: 1,
        pendingProcedural: false,
        // Assigned per body when the slot is claimed, since these are recycled.
        relief: null,
        reliefExaggeration: 1,
      });
    }
  }

  /**
   * Promote the nearest / selected minor bodies to real spheres.
   *
   * Without this, flying to Vesta would show you a point sprite. With it, the
   * ~600 small bodies cost six meshes rather than six hundred.
   */
  update(
    scale: ScaleModel,
    sunSceneRadius: number,
    minorBodies: ReadonlyArray<SimBody>,
    ctx: VisualContext,
  ): void {
    const camera = this.state.camera;
    if (!camera) {
      return;
    }

    const wanted: Array<{ body: SimBody; apparent: number }> = [];
    for (const body of minorBodies) {
      tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.state.origin);
      const distance = Math.max(camera.position.distanceTo(tmpVec), 1e-9);
      const apparent = (body.sceneRadius / distance) * this.state.viewport.y;
      if (
        apparent > SHAPE_APPARENT_PX ||
        body === this.state.selected ||
        body === this.state.focus
      ) {
        wanted.push({ body, apparent: body === this.state.focus ? 1e9 : apparent });
      }
    }
    wanted.sort((a, b) => b.apparent - a.apparent);
    const chosen = wanted.slice(0, PROMOTION_SLOTS);
    const chosenKeys = new Set(chosen.map((w) => w.body.key));

    // Release slots no longer wanted.
    for (const [key, visual] of this.promoted) {
      if (!chosenKeys.has(key)) {
        visual.group.visible = false;
        this.promoted.delete(key);
        this.promotionPool.push(visual);
      }
    }

    // Assign new ones.
    for (const { body } of chosen) {
      if (this.promoted.has(body.key)) {
        continue;
      }
      const slot = this.promotionPool.pop();
      if (!slot) {
        break;
      }
      // Claimed in place rather than copied: late texture loads hold on to this
      // very object and compare its body to tell whether the slot moved on.
      const visual: BodyVisual = Object.assign(slot, { body });
      visual.group.visible = true;
      // Flat colour now; the surface arrives on a later frame, so approaching a
      // new rock never costs a dropped frame.
      visual.material.uniforms.uMap.value = solidTexture(body.color);
      visual.material.needsUpdate = true;

      // Published shape, if this body has one — Phobos does. Cleared first:
      // these slots are recycled, and a slot that has just finished being
      // Phobos would otherwise hand its terrain to the next rock that lands in
      // it, which would look entirely convincing.
      visual.relief = null;
      visual.reliefExaggeration = RELIEF_EXAGGERATION[body.key] ?? 1;
      visual.material.uniforms.uHasRelief.value = 0;
      const relief = reliefFor(body.key);
      if (relief) {
        const target = visual;
        void whenLoaded(this.library.loadRelief(relief.file), (tex) => {
          if (target.body !== body) {
            return;
          }
          const u = target.material.uniforms;
          u.uRelief.value = tex;
          u.uReliefMinKm.value = relief.minKm;
          u.uReliefSpanKm.value = relief.maxKm - relief.minKm;
          u.uHasRelief.value = 1;
          target.relief = relief;
          target.material.needsUpdate = true;
        });
      }

      const file = body.textureFile;
      if (this.library.available(file)) {
        // Real imagery exists for this one (Vesta, and any other minor planet we
        // later find a map for) — always prefer it over a synthesised surface.
        visual.pendingProcedural = false;
        const target = visual;
        void whenLoaded(this.library.load(file), (tex) => {
          // The slot may have been reassigned while the texture decoded.
          if (target.body === body) {
            target.material.uniforms.uMap.value = tex;
            target.material.needsUpdate = true;
          }
        });
      } else {
        visual.pendingProcedural = true;
      }
      this.promoted.set(body.key, visual);
    }

    for (const visual of this.promoted.values()) {
      updateBodyVisual(visual, scale, sunSceneRadius, ctx);
    }
  }
}
