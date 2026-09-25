/** Making a body record, and the small vector helpers the solver uses on them. */

import type { Vec3 } from '../../astro/kepler.ts';
import type { PlanetKey } from '../../astro/planets.ts';
import type { BodySpec, BodyType } from '../../data/body-spec.ts';
import type { SimBody } from '../system.ts';
import { IDENTITY_BASIS } from '../../astro/frames.ts';
import { PLANET_KEYS } from '../../astro/planets.ts';
import { GM } from '../constants.ts';

export interface BodyInit {
  key: string;
  name: string;
  type: BodyType;
  subtitle: string;
  parent: SimBody | null;
  radiusKm: number;
  flattening: number;
  spec: BodySpec | null;
  color: number;
  textureFile: string | null;
  note: string | null;
  minor: boolean;
}

export function makeBody(init: BodyInit): SimBody {
  return {
    key: init.key,
    name: init.name,
    type: init.type,
    subtitle: init.subtitle,
    parent: init.parent,
    children: [],
    depth: 0,
    radiusKm: init.radiusKm,
    flattening: init.flattening,
    spec: init.spec,
    sat: null,
    small: null,
    lagrange: null,
    elements: null,
    basis: IDENTITY_BASIS,
    periodDays: 0,
    helioKm: { x: 0, y: 0, z: 0 },
    localKm: { x: 0, y: 0, z: 0 },
    velKm: { x: 0, y: 0, z: 0 },
    scene: { x: 0, y: 0, z: 0 },
    sceneRadius: 0,
    orientation: IDENTITY_BASIS,
    color: init.color,
    textureFile: init.textureFile,
    note: init.note,
    radiusEstimated: false,
    minor: init.minor,
  };
}

export const isPlanetKey = (key: string): key is PlanetKey =>
  (PLANET_KEYS as ReadonlyArray<string>).includes(key);

/** Own keys only, so an inherited name such as `toString` is not mistaken for a mass. */
export const hasGm = (key: string): key is keyof typeof GM => Object.hasOwn(GM, key);

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const zero = (v: Vec3): void => {
  v.x = 0;
  v.y = 0;
  v.z = 0;
};
export const copy = (dst: Vec3, src: Vec3): void => {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
};
export const addTo = (dst: Vec3, a: Vec3, b: Vec3): void => {
  dst.x = a.x + b.x;
  dst.y = a.y + b.y;
  dst.z = a.z + b.z;
};
export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
