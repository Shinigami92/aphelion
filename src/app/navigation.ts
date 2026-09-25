/** Where the camera arrives from and what the arrival is called. */

import type { CameraController } from '../controls/camera.ts';
import type { SimBody } from '../core/system.ts';
import type { Toast } from '../ui/panels/toast.ts';

/** Unit vector from a body toward the Sun, for daylit-side camera placement. */
function sunwardOf(body: SimBody): { x: number; y: number; z: number } | undefined {
  const r = Math.hypot(body.helioKm.x, body.helioKm.y, body.helioKm.z);
  if (r < 1) {
    return undefined; // the Sun itself
  }
  return { x: -body.helioKm.x / r, y: -body.helioKm.y / r, z: -body.helioKm.z / r };
}

/**
 * Which side to come in on, per kind of destination.
 *
 * A body wants the daylit side. A Lagrange point wants the *far* side from its
 * planet, so the marker is in the middle of the frame with the planet beyond
 * it — and, for the three collinear points, the Sun beyond that, which is the
 * alignment that gives them their meaning. Arriving on the near side would put
 * the camera between the two and leave the planet behind your shoulder.
 */
export function arrivalDirection(body: SimBody): { x: number; y: number; z: number } | undefined {
  if (body.type !== 'lagrange') {
    return sunwardOf(body);
  }
  const { x, y, z } = body.localKm;
  const d = Math.hypot(x, y, z);
  if (d < 1) {
    return undefined;
  }
  return { x: x / d, y: y / d, z: z / d };
}

/**
 * How the arrival toast names where you have landed. You orbit most things —
 * but not the Sun, not the Moon, and a Lagrange point is a station you hold, not
 * a body you circle. The subtitle is left to the departure toast that is still
 * on screen when a flight is short, and freshly remembered when it is long.
 */
function arrivalLabel(body: SimBody): string {
  if (body.type === 'star' || body.key === 'moon:Moon') {
    return `At the ${body.name}`;
  }
  if (body.type === 'lagrange') {
    return `Holding at ${body.name}`;
  }
  return `Orbiting ${body.name}`;
}

/** The planets in order from the Sun, for the number keys and Tab. */
export const PLANET_ORDER = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

/** Fly the camera to a body, announcing the departure and the arrival. */
export function flyTo(camera: CameraController, toast: Toast, body: SimBody): void {
  toast.show(`${body.name} — ${body.subtitle}`);
  camera.flyTo(body, {
    arriveFrom: arrivalDirection(body),
    onArrive: () => {
      toast.show(arrivalLabel(body));
    },
  });
}
