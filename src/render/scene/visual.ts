/** What the scene keeps per rendered body. */

import type { SimBody } from '../../core/system.ts';
import type { RingSpec } from '../../data/bodies.ts';
import type { ReliefMap } from '../../data/generated/relief.ts';
import type { Group, Mesh, ShaderMaterial } from 'three';

export interface RingVisual {
  mesh: Mesh;
  material: ShaderMaterial;
  spec: RingSpec;
}

export interface BodyVisual {
  body: SimBody;
  group: Group;
  mesh: Mesh;
  material: ShaderMaterial;
  clouds: Mesh | null;
  cloudMaterial: ShaderMaterial | null;
  /** Deck rotation relative to the crust, deg/day east. See `BodySpec`. */
  cloudDrift: number;
  atmosphere: Mesh | null;
  atmosphereMaterial: ShaderMaterial | null;
  rings: RingVisual[];
  /** Currently selected level-of-detail index. */
  lod: number;
  /**
   * True when this body has no real imagery and is still showing its flat
   * placeholder. The procedural surface is synthesised on demand, once the body
   * is actually big enough on screen to show it.
   */
  pendingProcedural: boolean;
  /**
   * Published elevation grid for this body, once it has loaded. Null for the
   * great majority, which render as their reference ellipsoid.
   */
  relief: ReliefMap | null;
  /** Exaggeration to apply at explore scale; 1 leaves relief true.  */
  reliefExaggeration: number;
}

/**
 * A recycled mesh for promoted minor bodies. Its body is null until the slot is
 * first claimed; once released it keeps the last one, which is harmless since
 * a released slot is hidden and never updated.
 */
export type PromotionSlot = Omit<BodyVisual, 'body'> & { body: SimBody | null };
