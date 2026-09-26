/** Impact craters for procedural surfaces: where they fall, and how they mark the albedo. */

export interface Crater {
  /** Unit vector of the crater centre. */
  x: number;
  y: number;
  z: number;
  /** Angular radius, radians. */
  radius: number;
  depth: number;
  bright: number;
}

export function generateCraters(rng: () => number, count: number, maxAngular: number): Crater[] {
  const craters: Crater[] = [];
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere.
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    // Power-law size distribution: many small, few large.
    const t = Math.pow(rng(), 2.4);
    craters.push({
      x: s * Math.cos(phi),
      y: s * Math.sin(phi),
      z: u,
      radius: maxAngular * (0.06 + 0.94 * t),
      depth: 0.35 + rng() * 0.5,
      bright: 0.6 + rng() * 0.8,
    });
  }
  // Largest first so small craters overprint big ones, as in reality.
  craters.sort((a, b) => b.radius - a.radius);
  return craters;
}

/**
 * Longitude half-width of the cap at this latitude. Close to the poles a
 * small cap spans every longitude, so fall back to the whole row.
 */
function lonHalfSpan(cosLat: number, reach: number): number {
  if (cosLat < 1e-4 || reach >= Math.PI / 2) {
    return Math.PI;
  }
  const ratio = Math.sin(reach) / cosLat;
  return ratio >= 1 ? Math.PI : Math.asin(ratio) * 1.15;
}

/** One pixel's shade, `t` crater radii from the centre. */
function craterShade(
  value: number,
  t: number,
  cr: Crater,
  maxAngular: number,
  ejecta: number,
): number {
  if (t < 0.82) {
    // Floor: darkened, with a slight central peak for larger craters.
    const floor = 1 - cr.depth * 0.42 * (1 - t * 0.5);
    const peak = cr.radius > maxAngular * 0.45 && t < 0.16 ? 1.16 : 1;
    return value * floor * peak;
  }
  if (t < 1.06) {
    return value * (1 + 0.3 * cr.bright);
  }
  const f = 1 - (t - 1.06) / 1.04;
  return value * (1 + ejecta * cr.bright * f * f * 0.6);
}

function stampCrater(
  shade: Float32Array,
  width: number,
  height: number,
  cr: Crater,
  maxAngular: number,
  ejecta: number,
): void {
  const reach = cr.radius * 2.1;
  const latC = Math.asin(Math.max(-1, Math.min(1, cr.z)));
  let lonC = Math.atan2(cr.y, cr.x);
  if (lonC < 0) {
    lonC += Math.PI * 2;
  }

  const jOf = (lat: number): number => (0.5 - lat / Math.PI) * height - 0.5;
  const jStart = Math.max(0, Math.floor(jOf(Math.min(Math.PI / 2, latC + reach))));
  const jEnd = Math.min(height - 1, Math.ceil(jOf(Math.max(-Math.PI / 2, latC - reach))));

  for (let j = jStart; j <= jEnd; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    const halfSpan = lonHalfSpan(cosLat, reach);
    const iSpan = Math.min(width / 2, (halfSpan / (Math.PI * 2)) * width + 1);
    const iCentre = (lonC / (Math.PI * 2)) * width - 0.5;

    for (let ii = Math.floor(iCentre - iSpan); ii <= Math.ceil(iCentre + iSpan); ii++) {
      const i = ((ii % width) + width) % width;
      const lon = ((i + 0.5) / width) * Math.PI * 2;
      const dotp = cosLat * Math.cos(lon) * cr.x + cosLat * Math.sin(lon) * cr.y + sinLat * cr.z;
      if (dotp <= 0) {
        continue; // far hemisphere
      }
      const ang = Math.acos(Math.min(1, dotp));
      if (ang > reach) {
        continue;
      }

      const t = ang / cr.radius;
      const idx = j * width + i;
      shade[idx] = craterShade(shade[idx], t, cr, maxAngular, ejecta);
    }
  }
}

/**
 * Stamp the craters into `shade` — a darkened floor, a bright rim and a fading
 * ejecta blanket.
 *
 * Each crater touches only the pixels inside its own latitude/longitude
 * extent. Testing every crater against every pixel is O(pixels x craters) and
 * was by far the most expensive thing in the app; bounding them makes it
 * O(total crater area), which is a 5-10x saving at these sizes.
 */
export function stampCraters(
  shade: Float32Array,
  width: number,
  height: number,
  craters: ReadonlyArray<Crater>,
  maxAngular: number,
  ejecta: number,
): void {
  for (const cr of craters) {
    stampCrater(shade, width, height, cr, maxAngular, ejecta);
  }
}
