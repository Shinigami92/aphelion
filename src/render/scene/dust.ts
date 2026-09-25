/** Travel dust: streaks that only exist while the camera is moving fast. */

import type { Scene, ShaderMaterial, Vector3 } from 'three';
import { BufferAttribute, BufferGeometry, LineSegments } from 'three';
import { createDustMaterial } from '../materials/orbit.ts';
import { vec3Uniform } from '../materials/uniforms.ts';
import { wrapInto } from './geometry.ts';

export class DustLayer {
  private dust: LineSegments | null = null;
  private dustMaterial: ShaderMaterial | null = null;

  /**
   * Build the travel dust: a fixed cloud of unit-cube positions, two vertices
   * per particle so the vertex shader can drag one end into a streak.
   *
   * Added to the scene root rather than to the world group, because it lives in
   * camera-relative space and must not be moved by the floating origin.
   */
  build(scene: Scene): void {
    // Two independent clouds, one per cross-faded lattice. They are drawn
    // together and never both at full weight, so the cost is one draw and about
    // one cloud's worth of visible particles.
    const count = 700 * 2;
    const positions = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    const lattices = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let end = 0; end < 2; end++) {
        const v = i * 2 + end;
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        ends[v] = end;
        lattices[v] = i % 2;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aEnd', new BufferAttribute(ends, 1));
    geo.setAttribute('aLattice', new BufferAttribute(lattices, 1));

    this.dustMaterial = createDustMaterial();
    this.dust = new LineSegments(geo, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 8;
    this.dust.visible = false;
    scene.add(this.dust);
  }

  /**
   * Point the dust at wherever the camera is and however fast it is going.
   *
   * `velocity` is the camera's motion in the *render* frame, which is the frame
   * the lattice sits still in — the dust keeps station with the focused body
   * rather than with the solar system, so parking beside Earth does not sweep it
   * past at Earth's 30 km/s.
   *
   * The cell is sized from the distance covered per second, so the field is
   * always dense enough to read as motion and never so dense it becomes fog —
   * but snapped to a power of two, because a cell that varies smoothly drags the
   * lattice with it (see `createDustMaterial`). The leftover fraction becomes the
   * cross-fade between the two lattices, so what varies smoothly with speed is
   * which of them you are looking at, not where either one is.
   */
  update(position: Vector3, velocity: Vector3, dt: number, intensity: number): void {
    if (!this.dust || !this.dustMaterial) {
      return;
    }

    const perSecond = velocity.length();
    // Nothing to draw when parked, and the field is pure noise on a still
    // image — a streak shorter than a pixel is just a speck in the way.
    const show = intensity > 0.01 && perSecond > 1e-6;
    this.dust.visible = show;
    if (!show) {
      return;
    }

    // Roughly one second of travel across the cell, so the density reads the
    // same whether the motion is kilometres or AU per second.
    const wanted = Math.max(perSecond * 1.4, 1e-4);
    const octaves = Math.log2(wanted);
    const octave = Math.floor(octaves);
    const low = 2 ** octave;
    const fraction = octaves - octave;

    // Which cloud takes the coarser cell alternates with the octave, and that
    // alternation is the whole trick. Pin cloud A to the finer cell and the two
    // swap scales the instant the octave steps — cloud A arriving at the cell
    // cloud B just left, but with its own seeds, so the visible field is
    // instantly re-rolled. Alternating instead leaves whichever cloud is
    // currently visible exactly where it is, and gives the rescale to the one
    // standing at zero weight.
    const evenOctave = octave % 2 === 0;
    const cellA = evenOctave ? low : low * 2;
    const cellB = evenOctave ? low * 2 : low;

    const u = this.dustMaterial.uniforms;
    u.uCellA.value = cellA;
    u.uCellB.value = cellB;
    u.uBlend.value = evenOctave ? fraction : 1 - fraction;
    wrapInto(vec3Uniform(u, 'uCamA'), position, cellA);
    wrapInto(vec3Uniform(u, 'uCamB'), position, cellB);
    vec3Uniform(u, 'uStreak').copy(velocity).multiplyScalar(dt);
    u.uIntensity.value = intensity;
  }
}
