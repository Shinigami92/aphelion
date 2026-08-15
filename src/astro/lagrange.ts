/**
 * Lagrange points of a two-body system.
 *
 * The five places where a third body of negligible mass keeps station relative
 * to two massive ones. They are the equilibria of the circular restricted
 * three-body problem: in the frame rotating with the pair, the gravity of both
 * primaries and the centrifugal term cancel exactly, so the effective potential
 *
 *     U = (x² + y²)/2 + (1 - mu)/r1 + mu/r2
 *
 * is stationary. Everything in this module is **nondimensional**: distances in
 * units of the separation between the primaries, the barycentre at the origin,
 * the primaries on the x axis at `-mu` and `1 - mu`, and +y along the secondary's
 * direction of travel. A caller turns that into kilometres by building the
 * rotating frame from a real separation vector — see `updateLagrange` in
 * core/system.ts, which is the only consumer.
 *
 * Two of the five are exact and three are not:
 *
 *   - **L4 and L5** sit at the apexes of the two equilateral triangles built on
 *     the line between the primaries. That is a closed-form result — no solving
 *     involved — and it is why they are exactly 60 degrees ahead of and behind
 *     the secondary, which is where Jupiter's Trojan camps are found.
 *   - **L1, L2 and L3** are roots of a quintic with no useful closed form. They
 *     are solved here by bisection on dU/dx, which is what actually defines
 *     them; the familiar `a·(mu/3)^(1/3)` Hill-radius figure is only the leading
 *     term of a series expansion — it is 0.3% high at Earth and 2.3% high at
 *     Jupiter, where the mass ratio is no longer quite so small.
 *
 * The collinear three are saddle points of U — unstable, with an e-folding time
 * of a few weeks at Sun-Earth L1/L2, which is why every spacecraft parked there
 * burns fuel to stay. L4 and L5 are potential *maxima* and yet stable, because
 * the Coriolis term turns a drifting body back; that holds whenever
 * mu < 0.0385, which every pair here satisfies by four orders of magnitude.
 */

export type LagrangeId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

/** The five points, in the conventional order. */
export const LAGRANGE_IDS: readonly LagrangeId[] = ['L1', 'L2', 'L3', 'L4', 'L5']

/** Whether a point is one of the unstable collinear three. */
export const isCollinear = (id: LagrangeId): boolean => id !== 'L4' && id !== 'L5'

/** A position in the rotating frame, in units of the separation. */
export interface RotatingPoint {
  /** Along the primary-to-secondary axis, barycentre at 0. */
  x: number
  /** Perpendicular to it, in the orbit plane, positive in the direction of travel. */
  y: number
}

/**
 * dU/dx on the axis joining the primaries.
 *
 * Written with the signed separations rather than `1/d²` so the expression is
 * valid on both sides of both primaries, which is what lets one function serve
 * all three collinear points.
 */
function potentialGradientX(x: number, mu: number): number {
  const d1 = x + mu // to the primary
  const d2 = x - 1 + mu // to the secondary
  return (
    x -
    ((1 - mu) * d1) / (Math.abs(d1) * d1 * d1) -
    (mu * d2) / (Math.abs(d2) * d2 * d2)
  )
}

/**
 * Bisection, deliberately, rather than Newton.
 *
 * Each bracket below spans a singularity-bounded interval in which dU/dx runs
 * monotonically from one infinity to the other, so a bisection cannot miss the
 * root or wander into the neighbouring primary — and Newton very much can, since
 * the second derivative blows up at both ends. Sixty halvings already exhaust
 * float64 near 1; the extra iterations cost nothing at eight planets, once.
 */
function bisect(mu: number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  const fa = potentialGradientX(a, mu)
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2
    const fm = potentialGradientX(m, mu)
    if (fm === 0) return m
    if (fm > 0 === fa > 0) a = m
    else b = m
  }
  return (a + b) / 2
}

/**
 * The five points for a mass ratio `mu = m2 / (m1 + m2)`.
 *
 * `mu` must be in (0, 0.5]; every pair modelled in Aphelion is far below that
 * (Sun-Jupiter, the largest, is 9.5e-4).
 */
export function lagrangeGeometry(mu: number): Record<LagrangeId, RotatingPoint> {
  // Offset from each singularity. Small enough not to bias any root — the
  // nearest of them, Sun-Jupiter L1, sits 0.067 away — and large enough that
  // squaring it stays finite.
  const eps = 1e-12

  return {
    // Between the two, the point a transfer has to climb over.
    L1: { x: bisect(mu, -mu + eps, 1 - mu - eps), y: 0 },
    // Beyond the secondary, in its shadow.
    L2: { x: bisect(mu, 1 - mu + eps, 3 - mu), y: 0 },
    // Beyond the primary, all but opposite the secondary.
    L3: { x: bisect(mu, -mu - 3, -mu - eps), y: 0 },
    // Exact: an equilateral triangle on the primaries, leading the secondary.
    L4: { x: 0.5 - mu, y: Math.sqrt(3) / 2 },
    // ...and the same, trailing it.
    L5: { x: 0.5 - mu, y: -Math.sqrt(3) / 2 },
  }
}

/**
 * Hill radius of the secondary, in units of the separation.
 *
 * The scale on which the secondary's gravity wins over the primary's, and to a
 * first approximation how far out L1 and L2 sit. Exported so callers get the
 * same figure the info panel quotes rather than open-coding the cube root.
 */
export const hillFraction = (mu: number): number => Math.cbrt(mu / 3)
