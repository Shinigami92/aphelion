/** Drawing the mini-map: orbit outlines, Lagrange markers, grid spacing, labels. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { OrbitSampler } from './orbit-sampler.ts';
import { AU_KM } from '../../core/constants.ts';
import { ORBIT_SAMPLES } from './orbit-sampler.ts';

/** A body as drawn, kept so a click can be matched back to it. */
export interface Plotted {
  body: SimBody;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  radius: number;
}

/** The planet whose Lagrange configuration a given body implies, if any. */
export function lagrangeHost(body: SimBody | null): SimBody | null {
  if (!body) {
    return null;
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
  return null;
}

/** One Lagrange point: a small ring with its name above it. */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  point: SimBody,
  sx: number,
  sy: number,
  isActive: boolean,
): void {
  const colour = `#${point.color.toString(16).padStart(6, '0')}`;
  ctx.strokeStyle = colour;
  ctx.lineWidth = isActive ? 1.6 : 1;
  ctx.globalAlpha = isActive ? 1 : 0.75;
  ctx.beginPath();
  ctx.arc(sx, sy, 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.fillText(point.name, sx, sy - 9);
  ctx.globalAlpha = 1;
}

/**
 * The five points of whichever planet is in play, as small labelled rings.
 *
 * One planet's set at a time, chosen the same way the 3D view chooses it: at
 * this size forty markers over eight orbits is a smear, and the whole value of
 * the plan view is that you can see which point is where.
 */
export function drawLagrange(
  ctx: CanvasRenderingContext2D,
  system: SolarSystem,
  focus: SimBody,
  selected: SimBody | null,
  cx: number,
  cy: number,
  scale: number,
  plotted: Plotted[],
): void {
  const host = lagrangeHost(focus) ?? lagrangeHost(selected);
  if (!host) {
    return;
  }

  // The map opens at a 109 AU span, where Jupiter's whole configuration is
  // five pixels across and its five labels land on top of each other. Nothing
  // is gained by drawing it until it is big enough to tell the points apart,
  // and the map zooms — so this is a legibility floor, not a hidden feature.
  const orbitPx = Math.hypot(host.helioKm.x, host.helioKm.y) * scale;
  if (orbitPx < 26) {
    return;
  }

  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const point of system.lagrangeOf(host.key)) {
    const sx = cx + point.helioKm.x * scale;
    const sy = cy - point.helioKm.y * scale;
    const isActive = point === selected || point === focus;
    drawMarker(ctx, point, sx, sy, isActive);

    plotted.push({
      body: point,
      x: point.helioKm.x,
      y: point.helioKm.y,
      screenX: sx,
      screenY: sy,
      radius: 3,
    });
  }
}

/** Reference-circle spacing for the heliocentric plan, in AU. */
export function gridStepAu(span: number): number {
  const au = span / AU_KM;
  if (au > 60) {
    return 20;
  }
  if (au > 20) {
    return 10;
  }
  if (au > 6) {
    return 5;
  }
  if (au > 2) {
    return 1;
  }
  return 0.5;
}

/** Reference-circle spacing for a moon system, km: a power of ten about a third of the span. */
export function moonGridStep(span: number): number {
  return Math.pow(10, Math.floor(Math.log10(span / 3)));
}

/** One orbit outline, brighter when its body is selected. */
export function drawOrbit(
  ctx: CanvasRenderingContext2D,
  orbits: OrbitSampler,
  body: SimBody,
  cx: number,
  cy: number,
  scale: number,
  highlight: boolean,
): void {
  if (!body.elements) {
    return;
  }
  const points = orbits.points(body);
  if (!points) {
    return;
  }

  ctx.strokeStyle = highlight
    ? 'rgba(111, 179, 255, 0.55)'
    : `rgba(150, 180, 220, ${body.type === 'moon' ? 0.16 : 0.2})`;
  ctx.lineWidth = highlight ? 1.4 : 1;
  ctx.beginPath();
  for (let i = 0; i < ORBIT_SAMPLES; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const sx = cx + x * scale;
    const sy = cy - y * scale;
    if (i === 0) {
      ctx.moveTo(sx, sy);
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  ctx.closePath();
  ctx.stroke();
}

export function formatShort(km: number): string {
  if (km > 1e6) {
    return `${(km / 1e6).toFixed(2)} M`;
  }
  if (km > 1e3) {
    return `${(km / 1e3).toFixed(0)} k`;
  }
  return km.toFixed(0);
}
