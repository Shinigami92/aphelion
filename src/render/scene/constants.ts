/** Numbers more than one part of the scene has to agree on. */

import type { Quality } from './types.ts';
import { Vector3 } from 'three';

/** Moons at or above this radius (km) get a full mesh from the start. */
export const MAJOR_MOON_RADIUS = 60;

/** Body-local rotation axis: every sphere here is built with the pole on +Z. */
export const POLE_AXIS = new Vector3(0, 0, 1);

/**
 * Apparent radius, in pixels, below which a body has no shape on screen.
 *
 * Under it a body is a dot however it is drawn — you can see *that* something is
 * there but nothing about it — so it is not worth real geometry and it is not
 * something a click can be aimed at. Both the promotion of minor bodies to
 * meshes and the hit test read it, and they should agree: anything the renderer
 * treats as a point, picking treats as part of whatever it is orbiting.
 */
export const SHAPE_APPARENT_PX = 2.5;

/**
 * Sphere tessellation per detail tier, swapped by apparent size.
 *
 * Relief displacement reads these too: its normals are differenced at the
 * spacing of whichever tier is drawn, so shading always describes the surface
 * actually on screen rather than detail the triangles cannot express.
 */
export const LOD_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [24, 14],
  [48, 26],
  [96, 52],
  [192, 96],
];

/**
 * How far proud of the analytic atmosphere the shell mesh is drawn.
 *
 * A polygonal sphere is inscribed in the sphere it stands for, so at 48x26 its
 * silhouette falls ~0.2% short. The shader intersects the true sphere, so any
 * shortfall clips the faintest, outermost haze into a hard-edged disc. 1% of a
 * shell that is itself 8-23% of a radius costs nothing.
 */
export const SHELL_MESH_MARGIN = 1.01;

/**
 * Screen size of a Lagrange marker, in CSS pixels.
 *
 * Constant with distance, unlike every other point in the scene. The markers
 * annotate places rather than standing in for objects, so shrinking them with
 * range would be saying something false — there is nothing there to get smaller.
 */
export const LAGRANGE_MARKER_PX = 13;

export const QUALITY: Record<
  Quality,
  { bloom: boolean; atmoSteps: number; maxPixelRatio: number; msaa: number; sphereBias: number }
> = {
  low: { bloom: false, atmoSteps: 6, maxPixelRatio: 1, msaa: 0, sphereBias: 0.6 },
  medium: { bloom: true, atmoSteps: 10, maxPixelRatio: 1.5, msaa: 2, sphereBias: 0.85 },
  high: { bloom: true, atmoSteps: 14, maxPixelRatio: 2, msaa: 4, sphereBias: 1 },
};
