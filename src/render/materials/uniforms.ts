/**
 * Typed uniform access and the eclipse occluder slots shared by the body and
 * cloud materials.
 */

import { ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from 'three';

/** Maximum simultaneous eclipse occluders per body. */
export const MAX_OCCLUDERS = 4;

// Typed uniform access
//
// Three types every uniform value as `any`, so a misspelt name or a value of
// the wrong kind would otherwise surface as an unexplained error somewhere deep
// inside a frame. Each accessor checks the value it hands back with a single
// `instanceof` — no allocation, so they are safe in the per-frame paths — and
// fails naming the uniform instead.

type Uniforms = ShaderMaterial['uniforms'];

function uniformOf<T>(
  uniforms: Uniforms,
  name: string,
  kind: abstract new (...args: never[]) => T,
): T {
  const value: unknown = uniforms[name]?.value;
  if (value instanceof kind) {
    return value;
  }
  throw new TypeError(`[aphelion] uniform ${name} does not hold a ${kind.name}`);
}

/** The Vector2 a uniform holds, to be updated in place. */
export function vec2Uniform(uniforms: Uniforms, name: string): Vector2 {
  return uniformOf(uniforms, name, Vector2);
}

/** The Vector3 a uniform holds, to be updated in place. */
export function vec3Uniform(uniforms: Uniforms, name: string): Vector3 {
  return uniformOf(uniforms, name, Vector3);
}

/** The texture a sampler uniform currently points at. */
export function textureUniform(uniforms: Uniforms, name: string): Texture {
  return uniformOf(uniforms, name, Texture);
}

function isVector4Array(value: unknown): value is Vector4[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const items: ReadonlyArray<unknown> = value;
  for (const item of items) {
    if (!(item instanceof Vector4)) {
      return false;
    }
  }
  return true;
}

/** The fixed-length occluder slots of an eclipse-aware material, if it has them. */
export function occluderSlots(material: ShaderMaterial): Vector4[] | undefined {
  const value: unknown = material.uniforms.uOccluders?.value;
  return isVector4Array(value) ? value : undefined;
}

/** Push occluder data into a material's uniform array. */
export function setOccluders(
  material: ShaderMaterial,
  occluders: Array<{ x: number; y: number; z: number; radius: number }>,
): void {
  const slot = occluderSlots(material);
  if (slot === undefined) {
    return;
  }
  for (let i = 0; i < MAX_OCCLUDERS; i++) {
    const dst = slot[i];
    if (i < occluders.length) {
      const src = occluders[i];
      dst.set(src.x, src.y, src.z, src.radius);
    } else {
      dst.set(0, 0, 0, 0);
    }
  }
}
