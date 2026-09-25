/** Orbit lines, resampled a few times a second and re-seated on their parents every frame. */

import type { ScaleModel } from '../../core/scale.ts';
import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { ShaderMaterial } from 'three';
import { BufferAttribute, BufferGeometry, Group, Line } from 'three';
import { createOrbitMaterial } from '../materials/orbit.ts';
import { MAJOR_MOON_RADIUS } from './constants.ts';
import { float32Array, plainAttribute } from './geometry.ts';

export class OrbitLayer {
  private orbitGroup = new Group();
  private orbitLines = new Map<string, { line: Line; material: ShaderMaterial }>();
  private orbitRebuildTimer = 0;

  constructor(
    private readonly state: FrameState,
    world: Group,
  ) {
    world.add(this.orbitGroup);
  }

  update(system: SolarSystem, scale: ScaleModel, dt: number): void {
    this.orbitGroup.visible = this.state.toggles.orbits !== 'none';
    if (!this.orbitGroup.visible) {
      return;
    }

    // Follow the parents every frame. Vertices are stored parent-relative, so
    // each line has to be re-seated on its parent as that parent moves —
    // rebuilding on the timer alone would let a moon's orbit lag behind its
    // planet by up to a quarter second of orbital motion.
    for (const [key, entry] of this.orbitLines) {
      const parent = system.byKey.get(key)?.parent;
      if (parent) {
        entry.line.position.set(parent.scene.x, parent.scene.y, parent.scene.z);
      }
    }

    // Shape only changes as the scale blends or the elements precess, so
    // resampling a few times a second is plenty.
    this.orbitRebuildTimer -= dt;
    const force = scale.isTransitioning;
    if (this.orbitRebuildTimer > 0 && !force) {
      return;
    }
    this.orbitRebuildTimer = 0.25;

    const wanted = new Set<string>();
    const consider = (body: SimBody, opacity: number): void => {
      if (!body.elements && body.key !== 'moon:Moon') {
        return;
      }
      wanted.add(body.key);
      this.ensureOrbit(body, system, scale, opacity);
    };

    for (const body of system.sun.children) {
      if (body.type === 'planet' || body.type === 'dwarf') {
        consider(body, 0.3);
      }
    }
    if (this.state.toggles.orbits === 'all') {
      for (const body of system.bodies) {
        if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) {
          consider(body, 0.22);
        }
        if (body.type === 'asteroid') {
          consider(body, 0.14);
        }
      }
    } else {
      // Even in "planets" mode, show the moons of whatever you are looking at —
      // but only the major ones. Drawing all 291 of Saturn's (or all 214 minor
      // planets, when the Sun is focused) turns the screen into a ball of wool.
      const host = this.state.focus?.type === 'moon' ? this.state.focus.parent : this.state.focus;
      if (host && host !== system.sun) {
        const majors = host.children
          .filter((c) => c.type === 'moon' && c.radiusKm >= MAJOR_MOON_RADIUS)
          .toSorted((a, b) => b.radiusKm - a.radiusKm)
          .slice(0, 12);
        for (const moon of majors) {
          consider(moon, 0.28);
        }
      }
    }
    if (this.state.selected) {
      consider(this.state.selected, 0.55);
    }

    for (const [key, entry] of this.orbitLines) {
      if (!wanted.has(key)) {
        this.orbitGroup.remove(entry.line);
        entry.line.geometry.dispose();
        entry.material.dispose();
        this.orbitLines.delete(key);
      }
    }
  }

  private ensureOrbit(
    body: SimBody,
    system: SolarSystem,
    scale: ScaleModel,
    opacity: number,
  ): void {
    const segments = body.type === 'asteroid' ? 192 : 512;
    const points = system.orbitPolyline(body, scale, segments);
    if (!points) {
      return;
    }

    let entry = this.orbitLines.get(body.key);
    if (entry) {
      const attr = plainAttribute(entry.line.geometry, 'position');
      if (attr.array.length === points.length) {
        float32Array(attr).set(points);
        attr.needsUpdate = true;
      } else {
        entry.line.geometry.setAttribute('position', new BufferAttribute(points, 3));
      }
    } else {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(points, 3));
      const indices = new Float32Array(segments + 1);
      for (let i = 0; i <= segments; i++) {
        indices[i] = i;
      }
      geo.setAttribute('aIndex', new BufferAttribute(indices, 1));
      const material = createOrbitMaterial(body.color, opacity);
      material.uniforms.uCount.value = segments;
      const line = new Line(geo, material);
      line.frustumCulled = false;
      line.renderOrder = 1;
      this.orbitGroup.add(line);
      entry = { line, material };
      this.orbitLines.set(body.key, entry);
      // Seat it on the parent immediately; the per-frame loop above keeps it
      // there. Three composes this translation on the CPU in float64, so the
      // large offset never touches the float32 vertex buffer.
      const parent = body.parent;
      if (parent) {
        line.position.set(parent.scene.x, parent.scene.y, parent.scene.z);
      }
    }
    entry.material.uniforms.uOpacity.value = body === this.state.selected ? 0.7 : opacity;
  }
}
