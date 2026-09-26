/** Body name labels, as a recycled pool of DOM elements over the canvas. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { LAGRANGE_MARKER_PX, MAJOR_MOON_RADIUS } from './constants.ts';
import { activeLagrangeHost } from './lagrange.ts';

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();

export class LabelLayer {
  private labelHost: HTMLElement | null = null;
  private labelPool: HTMLElement[] = [];

  constructor(private readonly state: FrameState) {}

  setHost(host: HTMLElement): void {
    this.labelHost = host;
  }

  update(system: SolarSystem, lagrangeBodies: ReadonlyArray<SimBody>): void {
    const host = this.labelHost;
    const camera = this.state.camera;
    if (!host || !camera) {
      return;
    }

    if (this.state.toggles.labels === 'none') {
      for (const el of this.labelPool) {
        el.style.display = 'none';
      }
      return;
    }

    const candidates = this.candidates(system, lagrangeBodies);
    let used = 0;
    for (const body of candidates) {
      if (used >= 120) {
        break;
      }
      if (this.placeLabel(body, camera, used)) {
        used++;
      }
    }
    for (let i = used; i < this.labelPool.length; i++) {
      this.labelPool[i].style.display = 'none';
    }
  }

  /** The bodies that may get a label this frame. */
  private candidates(system: SolarSystem, lagrangeBodies: ReadonlyArray<SimBody>): SimBody[] {
    const candidates: SimBody[] = [];
    for (const body of system.bodies) {
      if (body.type === 'star' || body.type === 'planet' || body.type === 'dwarf') {
        candidates.push(body);
      } else if (this.state.toggles.labels === 'all') {
        candidates.push(body);
      } else if (body === this.state.selected || body === this.state.focus) {
        candidates.push(body);
      } else if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) {
        // Only label moons of the system you are actually in, or the clutter is
        // unreadable.
        const host2 =
          this.state.focus?.type === 'moon' ? this.state.focus.parent : this.state.focus;
        if (body.parent === host2) {
          candidates.push(body);
        }
      }
    }

    // Lagrange points, labelled only for the configuration in play — the same
    // rule the moons follow, and for the same reason. "L1" beside Neptune while
    // you are at Earth says nothing.
    if (this.state.toggles.lagrange) {
      const lagrangeHost = activeLagrangeHost(this.state);
      for (const point of lagrangeBodies) {
        if (point.lagrange!.secondary === lagrangeHost || point === this.state.selected) {
          candidates.push(point);
        }
      }
    }
    return candidates;
  }

  /** Show `body`'s label in pool slot `index`, or return false if it is off screen or not needed. */
  private placeLabel(body: SimBody, camera: PerspectiveCamera, index: number): boolean {
    tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.state.origin);
    const distance = camera.position.distanceTo(tmpVec);
    // Skip if behind the camera or absurdly far relative to the view.
    tmpVec2.copy(tmpVec).project(camera);
    if (tmpVec2.z > 1 || tmpVec2.z < -1) {
      return false;
    }
    const x = (tmpVec2.x * 0.5 + 0.5) * this.state.viewport.x;
    const y = (-tmpVec2.y * 0.5 + 0.5) * this.state.viewport.y;
    if (x < -80 || y < -20 || x > this.state.viewport.x + 80 || y > this.state.viewport.y + 20) {
      return false;
    }

    // Hide the label when the body fills the screen: you know where it is.
    // A Lagrange point never does — its radius is a framing convention, not a
    // size — so it is measured as the marker it is: a fixed handful of pixels.
    const apparent =
      body.type === 'lagrange'
        ? LAGRANGE_MARKER_PX * 0.5
        : (body.sceneRadius / Math.max(distance, 1e-9)) * this.state.viewport.y;
    if (apparent > this.state.viewport.y * 0.75) {
      return false;
    }

    const el = this.labelElement(index);
    el.style.display = 'block';
    el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${(y - Math.min(apparent, 40) - 12).toFixed(1)}px)`;
    const isSelected = body === this.state.selected;
    el.textContent = body.name;
    el.className = `label label--${body.type}${isSelected ? ' label--selected' : ''}`;
    el.style.opacity = String(
      isSelected ? 1 : body.type === 'moon' || body.type === 'asteroid' ? 0.62 : 0.9,
    );
    return true;
  }

  private labelElement(index: number): HTMLElement {
    let el: HTMLElement | undefined = this.labelPool[index];
    if (el === undefined) {
      el = document.createElement('div');
      el.className = 'label';
      this.labelHost!.append(el);
      this.labelPool[index] = el;
    }
    return el;
  }
}
