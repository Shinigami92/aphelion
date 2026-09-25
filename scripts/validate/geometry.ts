/** Small angle and vector helpers shared by the frame and star checks. */

export const lonApart = (a: number, b: number): number =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180);

export const dot = (a: { x: number; y: number; z: number }, b: typeof a): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
