/** The one store every generated texture is memoised in, and the pixel clamp they share. */

import type { Texture } from 'three';

export const cache = new Map<string, Texture>();

export const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.trunc(v));
