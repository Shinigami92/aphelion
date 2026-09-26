/** Geometry builders and small numeric helpers shared across the scene. */

import type { Basis } from '../../astro/frames.ts';
import type { ShaderMaterial } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Vector2,
  Vector3,
} from 'three';

/**
 * Unit sphere with the rotation pole along +z and an equirectangular parameter-
 * isation: u runs eastward, v from the north pole down.
 *
 * Three's own SphereGeometry puts the pole on +y and winds u the other way,
 * which would mirror every map and mis-place every prime meridian, so we build
 * our own.
 *
 * Note the 0.5 offset on u. Geometry longitude is measured east from the body's
 * prime meridian (+x in the body-fixed frame, per the IAU rotation model), but
 * an equirectangular map's left edge is 180 degrees *west* of that meridian.
 * Without the half-turn every planet is rendered rotated 180 degrees — which
 * looks perfectly plausible until you check a sub-solar point against the clock
 * and find noon over the wrong hemisphere.
 */
export function createSphere(widthSegments: number, heightSegments: number): BufferGeometry {
  const w = Math.max(6, widthSegments);
  const h = Math.max(4, heightSegments);
  const count = (w + 1) * (h + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  let p = 0;
  for (let j = 0; j <= h; j++) {
    const v = j / h;
    const theta = v * Math.PI; // 0 at north pole
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let i = 0; i <= w; i++) {
      const u = i / w;
      const lon = u * Math.PI * 2;
      const x = sinT * Math.cos(lon);
      const y = sinT * Math.sin(lon);
      const z = cosT;
      positions[p * 3] = x;
      positions[p * 3 + 1] = y;
      positions[p * 3 + 2] = z;
      normals[p * 3] = x;
      normals[p * 3 + 1] = y;
      normals[p * 3 + 2] = z;
      // See the note above: shift the map so u = 0.5 is the prime meridian.
      uvs[p * 2] = u + 0.5;
      uvs[p * 2 + 1] = v;
      p++;
    }
  }
  const indices = sphereIndices(w, h);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Triangles for the sphere grid, skipping the degenerate ones at the poles. */
function sphereIndices(w: number, h: number): number[] {
  const indices: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i;
      const b = a + 1;
      const c = a + (w + 1);
      const d = c + 1;
      if (j !== 0) {
        indices.push(a, c, b);
      }
      if (j !== h - 1) {
        indices.push(b, c, d);
      }
    }
  }
  return indices;
}

/**
 * A patch of instanced rocks. `position` is a unit sphere the vertex shader
 * deforms per instance; everything about where a rock *is* comes from its slot
 * attributes, so the buffer is uploaded once and never touched again.
 */
export function createRingParticleGeometry(count: number): InstancedBufferGeometry {
  const base = createSphere(6, 4);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.instanceCount = count;

  const offsets = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  // Deterministic, so a ring looks the same every time you fly back into it.
  let state = 0x9e3779b9;
  const rnd = (): number => {
    // oxlint-disable-next-line unicorn/prefer-math-trunc -- int32 wraparound, not truncation
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = rnd() * 2 - 1;
    offsets[i * 3 + 1] = rnd() * 2 - 1;
    // Concentrated toward the ring plane: a ring is not a uniform slab.
    offsets[i * 3 + 2] = (rnd() + rnd() + rnd() - 1.5) / 1.5;
    seeds[i] = rnd();
  }
  geo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  return geo;
}

/**
 * Flat annulus in the xy plane, for ring systems, parameterised in true
 * kilometres.
 *
 * `position` holds only the unit direction around the ring; the real radius
 * rides alongside in `aRingKm` and the vertex shader turns one into the other.
 * That split is what lets a single geometry serve both scale models without a
 * rebuild, and what keeps the profile registered to kilometres rather than to
 * whatever the radial remap did to them.
 *
 * Subdivided radially because that remap is a power law. Two rings of vertices
 * would draw the curve as a chord — at Saturn, a 66,000 km wide annulus drawn
 * as a single span misplaces its middle by tens of scene units, which is the
 * width of several gaps.
 */
export function createAnnulus(
  innerKm: number,
  outerKm: number,
  segments: number,
  radialSteps: number,
): BufferGeometry {
  const seg = Math.max(48, segments);
  const steps = Math.max(2, radialSteps);
  const count = (seg + 1) * (steps + 1);
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const indices: number[] = [];

  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (let j = 0; j <= steps; j++) {
      const v = i * (steps + 1) + j;
      const o = v * 3;
      positions[o] = cos;
      positions[o + 1] = sin;
      positions[o + 2] = 0;
      radii[v] = innerKm + ((outerKm - innerKm) * j) / steps;
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < steps; j++) {
      const a = i * (steps + 1) + j;
      const b = (i + 1) * (steps + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('aRingKm', new BufferAttribute(radii, 1));
  geo.setIndex(indices);
  // No normals: the ring shader takes its normal from the pole uniform, since a
  // flat sheet's vertex normals say nothing the plane's own normal does not.
  return geo;
}

/**
 * A geometry attribute this file built as a plain buffer.
 *
 * `getAttribute` admits interleaved attributes too, which have no array of
 * their own to write into. Every attribute read back here was created as a
 * `BufferAttribute`, so this only confirms it — an `instanceof`, cheap enough
 * for the per-frame writers.
 */
export function plainAttribute(geometry: BufferGeometry, name: string): BufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (attribute instanceof BufferAttribute) {
    return attribute;
  }
  throw new TypeError(`[aphelion] attribute ${name} is not a plain BufferAttribute`);
}

/** The Float32 storage behind an attribute that was built from one. */
export function float32Array(attribute: BufferAttribute): Float32Array {
  const array = attribute.array;
  if (array instanceof Float32Array) {
    return array;
  }
  throw new TypeError(`[aphelion] attribute ${attribute.name} is not backed by a Float32Array`);
}

/** Push the viewport size to a points material, if it is one that sizes by it. */
export function setViewport(
  material: ShaderMaterial | null | undefined,
  width: number,
  height: number,
): void {
  const viewport: unknown = material?.uniforms.uViewport?.value;
  if (viewport instanceof Vector2) {
    viewport.set(width, height);
  }
}

/** GLSL's smoothstep, on the CPU side. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Reduce a position into one cell of a lattice, component-wise, in double
 * precision. The shader's wrap is unchanged by this — the two differ by a whole
 * number of cells — but the number it receives is now the size of a cell rather
 * than the size of the solar system, which is the difference between a float32
 * uniform resolving the wrap and quantising it.
 */
export function wrapInto(out: Vector3, position: Vector3, cell: number): Vector3 {
  return out.set(
    position.x - Math.floor(position.x / cell) * cell,
    position.y - Math.floor(position.y / cell) * cell,
    position.z - Math.floor(position.z / cell) * cell,
  );
}

/** Load an orthonormal basis into a rotation matrix. */
export function basisToMatrix(basis: Basis, out: Matrix4): Matrix4 {
  return out.set(
    basis.x.x,
    basis.y.x,
    basis.z.x,
    0,
    basis.x.y,
    basis.y.y,
    basis.z.y,
    0,
    basis.x.z,
    basis.y.z,
    basis.z.z,
    0,
    0,
    0,
    0,
    1,
  );
}

/** A rotation whose z axis is `pole` — used for ring planes. */
export function poleMatrix(pole: { x: number; y: number; z: number }, out: Matrix4): Matrix4 {
  const z = new Vector3(pole.x, pole.y, pole.z).normalize();
  const helper = Math.abs(z.z) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const x = new Vector3().crossVectors(helper, z).normalize();
  const y = new Vector3().crossVectors(z, x);
  return out.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1);
}
