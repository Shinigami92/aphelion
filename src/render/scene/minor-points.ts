/** The minor bodies without a mesh of their own, as one point cloud. */

import type { SimBody } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual } from './visual.ts';
import type { Group, ShaderMaterial } from 'three';
import { BufferAttribute, BufferGeometry, Color, Points } from 'three';
import { createMinorPointsMaterial } from '../materials/minor-points.ts';
import { pointSprite } from '../procedural.ts';
import { setViewport } from './geometry.ts';

export class MinorPointsLayer {
  private minorPoints: Points<BufferGeometry, ShaderMaterial> | null = null;
  /** Everything that did not get its own mesh; the promotions draw from it. */
  minorBodies: SimBody[] = [];
  private minorPositions: Float32Array = new Float32Array(0);
  private minorSizes: Float32Array = new Float32Array(0);

  constructor(private readonly state: FrameState) {}

  build(world: Group, bodies: SimBody[]): void {
    this.minorBodies = bodies;
    const n = this.minorBodies.length;
    this.minorPositions = new Float32Array(n * 3);
    this.minorSizes = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.set(this.minorBodies[i].color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      this.minorSizes[i] = 1;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.minorPositions, 3));
    geo.setAttribute('aColor', new BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.minorSizes, 1));

    const pointsMaterial = createMinorPointsMaterial(pointSprite());
    const points = new Points(geo, pointsMaterial);
    points.frustumCulled = false;
    points.renderOrder = 6;
    world.add(points);
    this.minorPoints = points;
  }

  update(promoted: ReadonlyMap<string, BodyVisual>): void {
    const points = this.minorPoints;
    if (!points) {
      return;
    }
    points.visible = this.state.toggles.minorBodies;
    if (!points.visible) {
      return;
    }

    const camera = this.state.camera;
    for (let i = 0; i < this.minorBodies.length; i++) {
      const body = this.minorBodies[i];
      // Absolute scene coordinates; the world group applies the origin shift.
      this.minorPositions[i * 3] = body.scene.x;
      this.minorPositions[i * 3 + 1] = body.scene.y;
      this.minorPositions[i * 3 + 2] = body.scene.z;
      // Hide the point when the body has been promoted to a real sphere.
      this.minorSizes[i] = promoted.has(body.key) ? 0 : 1;
    }
    void camera;
    points.geometry.getAttribute('position').needsUpdate = true;
    points.geometry.getAttribute('aSize').needsUpdate = true;

    points.material.uniforms.uPixelRatio.value = this.state.pixelRatio;
  }

  resize(width: number, height: number): void {
    setViewport(this.minorPoints?.material, width, height);
  }
}
