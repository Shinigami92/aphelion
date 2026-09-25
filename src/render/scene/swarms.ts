/** The statistical belt swarms, orbiting on the GPU. */

import type { ScaleModel } from '../../core/scale.ts';
import type { SolarSystem } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { Group, ShaderMaterial } from 'three';
import { BufferAttribute, BufferGeometry, Points } from 'three';
import { SCENE_UNIT_KM } from '../../core/constants.ts';
import { buildSwarms } from '../../data/belts.ts';
import { createSwarmMaterial } from '../materials/swarm.ts';
import { pointSprite } from '../procedural.ts';
import { setViewport } from './geometry.ts';

export class SwarmLayer {
  private swarmPoints: Points | null = null;
  private swarmMaterial: ShaderMaterial | null = null;

  constructor(private readonly state: FrameState) {}

  build(world: Group): void {
    const data = buildSwarms();
    const geo = new BufferGeometry();
    // Position is unused (the vertex shader derives it) but Three requires it.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(data.total * 3), 3));
    geo.setAttribute('aA', new BufferAttribute(data.a, 1));
    geo.setAttribute('aE', new BufferAttribute(data.e, 1));
    geo.setAttribute('aInc', new BufferAttribute(data.inc, 1));
    geo.setAttribute('aNode', new BufferAttribute(data.node, 1));
    geo.setAttribute('aPeri', new BufferAttribute(data.argPeri, 1));
    geo.setAttribute('aM0', new BufferAttribute(data.m0, 1));
    geo.setAttribute('aN', new BufferAttribute(data.n, 1));
    geo.setAttribute('aSize', new BufferAttribute(data.size, 1));
    geo.setAttribute('aColor', new BufferAttribute(data.color, 3));

    const material = createSwarmMaterial(pointSprite());
    const points = new Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = 7;
    world.add(points);
    this.swarmPoints = points;
    this.swarmMaterial = material;
  }

  update(system: SolarSystem, scale: ScaleModel): void {
    const material = this.swarmMaterial;
    if (!material || !this.swarmPoints) {
      return;
    }
    this.swarmPoints.visible = this.state.toggles.belts;
    if (!this.swarmPoints.visible) {
      return;
    }

    material.uniforms.uDays.value = system.jdTT - 2451545.0;
    material.uniforms.uBlend.value = scale.blendAmount;
    material.uniforms.uHelioExp.value = scale.params.heliocentricExponent;
    material.uniforms.uSceneUnitKm.value = SCENE_UNIT_KM;
    material.uniforms.uPixelRatio.value = this.state.pixelRatio;
    // Dust, not paint: the belts should read as a haze you can see structure
    // through, not a solid torus that hides the planets behind it.
    material.uniforms.uOpacity.value = 0.5;
  }

  resize(width: number, height: number): void {
    setViewport(this.swarmMaterial, width, height);
  }
}
