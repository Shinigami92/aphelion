/** The Lagrange-point markers and the diagram drawn around the planet in play. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { Group, ShaderMaterial } from 'three';
import { BufferAttribute, BufferGeometry, Color, LineSegments, Points, Vector3 } from 'three';
import { createLagrangeMarkerMaterial } from '../materials/lagrange-marker.ts';
import { createOrbitMaterial } from '../materials/orbit.ts';
import { markerSprite } from '../procedural/sprites.ts';
import { float32Array, plainAttribute, smoothstep } from './geometry.ts';

/**
 * Segments of the diagram drawn around the active planet, as pairs of endpoints.
 *
 * `sun` and `planet` name the two primaries; the rest are point ids. Together
 * they draw the line the three collinear points sit on and the two equilateral
 * triangles that define L4 and L5 — which is the entire content of the
 * configuration, and much easier to see than to read.
 */
const LAGRANGE_FRAME: ReadonlyArray<readonly [string, string]> = [
  ['L3', 'sun'],
  ['sun', 'L1'],
  ['L1', 'planet'],
  ['planet', 'L2'],
  ['sun', 'L4'],
  ['L4', 'planet'],
  ['sun', 'L5'],
  ['L5', 'planet'],
];

/**
 * The planet whose Lagrange configuration is currently the subject.
 *
 * Forty markers with forty labels is clutter; five with a diagram is a
 * diagram. So the labels and the frame follow whatever you are actually
 * looking at — a planet, one of its moons, or one of its own Lagrange points —
 * and the selection wins over the focus, so clicking L4 in the browser lights
 * up its planet's configuration before the camera has even set off.
 */
export function activeLagrangeHost(state: FrameState): SimBody | null {
  for (const body of [state.selected, state.focus]) {
    if (!body) {
      continue;
    }
    if (body.type === 'lagrange') {
      return body.lagrange!.secondary;
    }
    if (body.type === 'planet') {
      return body;
    }
    if (body.type === 'moon' && body.parent?.type === 'planet') {
      return body.parent;
    }
  }
  return null;
}

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpVec = new Vector3();

export class LagrangeLayer {
  private lagrangePoints: Points | null = null;
  private lagrangeMaterial: ShaderMaterial | null = null;
  /** The markers, in buffer order; the labels and the hit test walk them too. */
  lagrangeBodies: SimBody[] = [];
  private lagrangeFrame: LineSegments | null = null;
  private lagrangeFrameMaterial: ShaderMaterial | null = null;

  constructor(private readonly state: FrameState) {}

  /**
   * The Lagrange-point markers and the diagram that explains them.
   *
   * Two objects. The markers are one small point cloud over every planet's five
   * points at once — forty in total, which is nothing, and keeping them in one
   * buffer means the whole layer switches on and off with a single `visible`.
   * The diagram is a single sixteen-vertex line strip whose positions are
   * rewritten each frame for whichever planet is currently in play: drawing all
   * eight configurations at once is unreadable, and eight persistent geometries
   * for something only ever shown one at a time is waste.
   */
  build(system: SolarSystem, world: Group): void {
    this.lagrangeBodies = system.lagrange;
    const n = this.lagrangeBodies.length;
    if (n === 0) {
      return;
    }

    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.set(this.lagrangeBodies[i].color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new BufferAttribute(colors, 3));
    // Per-point opacity, so the active planet's five can be brought forward
    // without splitting the buffer.
    geo.setAttribute('aFade', new BufferAttribute(new Float32Array(n), 1));

    const material = createLagrangeMarkerMaterial(markerSprite());
    const points = new Points(geo, material);
    points.frustumCulled = false;
    // Above the belt swarms: a marker hidden inside the Trojan camp it names is
    // no marker at all.
    points.renderOrder = 8;
    world.add(points);
    this.lagrangePoints = points;
    this.lagrangeMaterial = material;

    this.buildFrame(world);
  }

  /** The diagram: one line-segment buffer, repositioned onto whichever planet is in play. */
  private buildFrame(world: Group): void {
    const frameGeo = new BufferGeometry();
    frameGeo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(LAGRANGE_FRAME.length * 6), 3),
    );
    // The orbit shader tapers by vertex index; these lines do not taper, but the
    // attribute has to exist for the program to link.
    frameGeo.setAttribute(
      'aIndex',
      new BufferAttribute(new Float32Array(LAGRANGE_FRAME.length * 2), 1),
    );
    const frameMaterial = createOrbitMaterial(0x8fb4d8, 0);
    const frame = new LineSegments(frameGeo, frameMaterial);
    frame.frustumCulled = false;
    frame.renderOrder = 1;
    frame.visible = false;
    world.add(frame);
    this.lagrangeFrame = frame;
    this.lagrangeFrameMaterial = frameMaterial;
  }

  update(): void {
    const points = this.lagrangePoints;
    const frame = this.lagrangeFrame;
    if (!points || !frame) {
      return;
    }

    points.visible = this.state.toggles.lagrange;
    frame.visible = false;
    if (!points.visible) {
      return;
    }

    const host = activeLagrangeHost(this.state);
    this.updateMarkers(points, host);
    if (host) {
      this.updateFrame(frame, host);
    }
  }

  private updateMarkers(points: Points, host: SimBody | null): void {
    const positions = plainAttribute(points.geometry, 'position');
    const fades = plainAttribute(points.geometry, 'aFade');
    const positionArray = float32Array(positions);
    const fadeArray = float32Array(fades);

    for (let i = 0; i < this.lagrangeBodies.length; i++) {
      const body = this.lagrangeBodies[i];
      positionArray[i * 3] = body.scene.x;
      positionArray[i * 3 + 1] = body.scene.y;
      positionArray[i * 3 + 2] = body.scene.z;
      // The points of other planets stay drawn but recede: they are still worth
      // seeing at whole-system range — Jupiter's L4 and L5 sit in the middle of
      // the two Trojan camps — without competing with the set being explained.
      const active = body.lagrange!.secondary === host;
      fadeArray[i] = body === this.state.selected ? 1 : active ? 0.85 : 0.2;
    }
    positions.needsUpdate = true;
    fades.needsUpdate = true;

    if (this.lagrangeMaterial) {
      this.lagrangeMaterial.uniforms.uPixelRatio.value = this.state.pixelRatio;
    }
  }

  /**
   * The diagram spans two orbit radii, so from close in it is not a diagram —
   * it is four lines passing through the camera and off every edge of the
   * frame, and it turns a view of Earth into a view of streaks. It fades in
   * as you pull back far enough for the configuration to have a shape, which
   * is also the point at which the planet stops filling the view. Measured
   * against the planet, not the focus, so arriving at one of its own points
   * (a few dozen planet radii out) already shows the geometry that explains
   * where you are.
   */
  private updateFrame(frame: LineSegments, host: SimBody): void {
    const camera = this.state.camera;
    if (!camera || host.sceneRadius <= 0) {
      return;
    }
    tmpVec.set(host.scene.x, host.scene.y, host.scene.z).sub(this.state.origin);
    const radiiFromPlanet = camera.position.distanceTo(tmpVec) / host.sceneRadius;
    const strength = smoothstep(25, 60, radiiFromPlanet);
    if (this.lagrangeFrameMaterial) {
      this.lagrangeFrameMaterial.uniforms.uOpacity.value = 0.16 * strength;
    }
    if (strength <= 0) {
      return;
    }

    const geometry = new Map<string, SimBody>([['planet', host]]);
    let sun: SimBody | null = null;
    for (const body of this.lagrangeBodies) {
      if (body.lagrange!.secondary !== host) {
        continue;
      }
      geometry.set(body.lagrange!.id, body);
      sun = body.lagrange!.primary;
    }
    if (!sun) {
      return;
    }

    const frameAttribute = plainAttribute(frame.geometry, 'position');
    const frameArray = float32Array(frameAttribute);
    let vertex = 0;
    for (const [from, to] of LAGRANGE_FRAME) {
      for (const end of [from, to]) {
        const node = end === 'sun' ? sun : geometry.get(end);
        frameArray[vertex * 3] = node ? node.scene.x : 0;
        frameArray[vertex * 3 + 1] = node ? node.scene.y : 0;
        frameArray[vertex * 3 + 2] = node ? node.scene.z : 0;
        vertex++;
      }
    }
    frameAttribute.needsUpdate = true;
    frame.visible = true;
  }
}
