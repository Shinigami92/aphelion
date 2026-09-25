/** Cloud decks that move: the zonal wind split and the clock that shears them. */

import { ZONAL_SAMPLES } from '../materials/cloud.ts';

/**
 * Sim days over which a sheared cloud deck cycles back to unsheared.
 *
 * The one number here that is chosen by eye rather than measured, and the two
 * things it trades are locked together: a copy sways by T/4 of its travel and
 * the worst ghost is T/2 of it, so visible motion always costs twice as much
 * ghost. Only the *residual* passes through here, which is what makes a day
 * affordable — about 17 deg/day under the southern jet, so 8 degrees of ghost
 * at the crossover, which cloud edges are soft enough to absorb.
 */
const CLOUD_SHEAR_PERIOD_DAYS = 1;

/**
 * Ceiling on how fast the cloud flow clock may run, in sim days per real
 * second — the same guard the ring clocks use, for the same reason. At a year
 * a second the deck would otherwise recycle hundreds of times a frame and
 * dissolve into strobing noise; here it simply saturates, and nobody expects to
 * read weather off a planet that is a blur anyway.
 */
const CLOUD_FLOW_MAX_RATE = 1;

/**
 * Split a zonal wind profile into the part the deck can carry rigidly and the
 * part that has to shear.
 *
 * A wind is a linear speed, so the angular rate it implies is `u / (R cos lat)`
 * and grows without bound towards the poles, where the circle it is travelling
 * round shrinks to nothing. That is not an artefact — a few m/s really is a
 * brisk rotation at 85 degrees — but it does mean a profile must reach zero at
 * the poles or the top and bottom rows of the map spin up into a smear. The
 * floor on the cosine only keeps 0/0 out of the arithmetic at the poles
 * themselves; the profile is what keeps the rate sane near them.
 *
 * The split is the point of this function. Shear has to be recycled or it tears
 * the map into stripes, and anything recycled can only ever sway about where it
 * started — so a shear-only deck has *no* net transport, which is a worse lie
 * than the rigid sheet it replaced. Handing the area-weighted mean to the mesh
 * quaternion instead gives that part back: unbounded, exact, artefact-free.
 * What is left over is the latitude structure, which is small enough to recycle
 * cheaply and is the only part that ever needed a shader.
 *
 * The honest cost, worth knowing before reading too much into a render: only
 * the mean survives as net transport, so over many cycles the tropics drift
 * *east* with everything else, where the real trades run west.
 */
export function zonalFlow(
  windMs: ReadonlyArray<number>,
  radiusKm: number,
): { meanDegPerDay: number; residualDegPerDay: number[] } {
  const rates: number[] = [];
  let weighted = 0;
  let weight = 0;
  for (let i = 0; i < ZONAL_SAMPLES; i++) {
    const latDeg = -90 + (180 * i) / (ZONAL_SAMPLES - 1);
    const cos = Math.cos((latDeg * Math.PI) / 180);
    const circumferenceM = 2 * Math.PI * radiusKm * 1000 * Math.max(cos, 1e-6);
    const rate = ((windMs[i] ?? 0) * 86400 * 360) / circumferenceM;
    rates.push(rate);
    // Weight by the area each sample stands for, which goes as cos(lat).
    weighted += rate * Math.max(cos, 0);
    weight += Math.max(cos, 0);
  }
  const meanDegPerDay = weight > 0 ? weighted / weight : 0;
  return { meanDegPerDay, residualDegPerDay: rates.map((r) => r - meanDegPerDay) };
}

export class CloudClock {
  /**
   * Age of the cloud shear, in sim days, and the clock it is advanced from.
   *
   * Kept separate from the frame date because it is rate-limited: it tracks sim time
   * but cannot be dragged forward faster than `CLOUD_FLOW_MAX_RATE`.
   */
  private cloudFlowDays = 0;
  private lastCloudJdTT: number | null = null;
  /** The two copies' ages in days, and the second's weight. Set once a frame. */
  cloudPhaseA = 0;
  cloudPhaseB = 0;
  cloudBlend = 0;

  /**
   * Advance the cloud shear and resolve the two copies' ages from it.
   *
   * All of the phase arithmetic is done here, in float64, and only the reduced
   * result reaches the shader. Handing a shader `days` directly would be a slow
   * poison: 8,456 days lands where float32 steps in units of about a
   * thousandth, so the deck would advance in visible jerks instead of flowing.
   */
  advance(jdTT: number, dt: number): void {
    const previous = this.lastCloudJdTT;
    this.lastCloudJdTT = jdTT;
    if (previous !== null) {
      const limit = CLOUD_FLOW_MAX_RATE * Math.max(dt, 1e-4);
      this.cloudFlowDays += Math.max(-limit, Math.min(limit, jdTT - previous));
    }

    const T = CLOUD_SHEAR_PERIOD_DAYS;
    // Position within the cycle, always in [0, 1) however far back the clock is.
    const p = (((this.cloudFlowDays / T) % 1) + 1) % 1;
    const pB = (p + 0.5) % 1;
    // Ages centred on zero, so each copy wraps from +T/2 to -T/2 — a jump that
    // is invisible because it happens exactly where that copy's weight is zero.
    this.cloudPhaseA = (p - 0.5) * T;
    this.cloudPhaseB = (pB - 0.5) * T;
    // 1 at p = 0 (B is fresh), 0 at p = 0.5 (A is fresh).
    this.cloudBlend = Math.abs(1 - 2 * p);
  }
}
