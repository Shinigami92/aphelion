/** The Sun: photosphere and corona. */

import type { SimBody } from '../../core/system.ts';
import type { TextureLibrary } from '../textures.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual } from './visual.ts';
import type { BufferGeometry, ShaderMaterial } from 'three';
import { Group, Matrix4, Mesh } from 'three';
import { createCoronaMaterial, createSunMaterial } from '../materials/sun.ts';
import { vec3Uniform } from '../materials/uniforms.ts';
import { whenLoaded } from '../textures.ts';
import { basisToMatrix } from './geometry.ts';

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpMatrix = new Matrix4();

export class SunLayer {
  /** Kept outside the body map; the hit test reads it. */
  sunVisual: BodyVisual | null = null;
  private coronaMesh: Mesh | null = null;
  private coronaMaterial: ShaderMaterial | null = null;

  constructor(private readonly state: FrameState) {}

  build(
    sun: SimBody,
    world: Group,
    lodGeometries: ReadonlyArray<BufferGeometry>,
    library: TextureLibrary,
  ): void {
    const group = new Group();
    const material = createSunMaterial(null);
    const mesh = new Mesh(lodGeometries[2], material);
    group.add(mesh);

    // Corona shell, generously oversized and additive.
    this.coronaMaterial = createCoronaMaterial();
    this.coronaMesh = new Mesh(lodGeometries[1], this.coronaMaterial);
    this.coronaMesh.renderOrder = 5;
    group.add(this.coronaMesh);

    world.add(group);
    this.sunVisual = {
      body: sun,
      group,
      mesh,
      material,
      clouds: null,
      cloudMaterial: null,
      cloudDrift: 0,
      atmosphere: null,
      atmosphereMaterial: null,
      rings: [],
      lod: 2,
      // The Sun always has its own imagery, and never a procedural stand-in.
      pendingProcedural: false,
      relief: null,
      reliefExaggeration: 1,
    };

    void whenLoaded(library.load('sun.jpg'), (tex) => {
      tex.flipY = false;
      material.uniforms.uMap.value = tex;
      material.uniforms.uHasMap.value = 1;
      material.needsUpdate = true;
    });
  }

  update(sun: SimBody, elapsedSeconds: number): void {
    const visual = this.sunVisual;
    if (!visual) {
      return;
    }
    visual.group.position.set(sun.scene.x, sun.scene.y, sun.scene.z);
    basisToMatrix(sun.orientation, tmpMatrix);
    visual.mesh.quaternion.setFromRotationMatrix(tmpMatrix);
    visual.mesh.scale.setScalar(sun.sceneRadius);
    visual.material.uniforms.uTime.value = elapsedSeconds;

    if (this.coronaMesh && this.coronaMaterial) {
      // The corona is drawn on a shell far larger than the photosphere.
      const outer = sun.sceneRadius * 4.5;
      this.coronaMesh.scale.setScalar(outer);
      vec3Uniform(this.coronaMaterial.uniforms, 'uCentre').copy(this.state.sunRender);
      this.coronaMaterial.uniforms.uInner.value = sun.sceneRadius * 0.98;
      this.coronaMaterial.uniforms.uOuter.value = outer;
      this.coronaMaterial.uniforms.uIntensity.value = 0.55;
    }
  }
}
