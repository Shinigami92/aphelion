/** Tidally locked frames face their planets. */

import { ScaleModel } from '../../src/core/scale.ts';
import { SolarSystem } from '../../src/core/system.ts';
import { jdTT } from './epoch.ts';
import { dot, lonApart } from './geometry.ts';
import { ok, section } from './harness.ts';

export function checkTidalLocking(): void {
  section('Tidally locked frames');

  /** Angular separation in longitude, accounting for the wrap. Always 0..180. */

  // A tidally locked moon's prime meridian faces its planet — that is what the
  // IAU convention means, and every satellite map and shape model is drawn in it.
  // Get this backwards and each of the 459 moons is rendered half a turn out,
  // which is invisible on a synthesised surface and wrong on every real one.
  {
    const system = new SolarSystem();
    const scale = new ScaleModel();
    system.update(jdTT, scale);

    for (const key of ['moon:Moon', 'moon:Phobos']) {
      const body = system.byKey.get(key);
      if (!body || !body.parent) {
        ok(`${key} present for the tidal-lock frame check`, false);
        continue;
      }
      const p = body.localKm;
      const n = Math.hypot(p.x, p.y, p.z);
      const toParent = { x: -p.x / n, y: -p.y / n, z: -p.z / n };
      const b = body.orientation;
      let lon = (Math.atan2(dot(toParent, b.y), dot(toParent, b.x)) * 180) / Math.PI;
      if (lon < 0) {
        lon += 360;
      }
      const lat = (Math.asin(dot(toParent, b.z)) * 180) / Math.PI;
      ok(
        `${key} points its prime meridian at its parent`,
        lonApart(lon, 0) < 0.5 && Math.abs(lat) < 0.5,
        `sub-parent point at ${lat.toFixed(2)}N ${lon.toFixed(2)}E, expected 0N 0E`,
      );
    }
  }
}
