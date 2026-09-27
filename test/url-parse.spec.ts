/**
 * Reading a shared view back out of a hand-edited, truncated or mangled query.
 *
 * The rule under test is the decoder's one promise: whatever it cannot read it
 * ignores, so the link still opens with fewer fields restored. In particular a
 * typo never silently switches a layer off or pauses the clock, and an emptied
 * number is missing rather than zero.
 */

import { describe, expect, it } from 'vitest';
import { parseUtc } from '../src/astro/calendar.ts';
import { parseView } from '../src/core/url-parse.ts';
import { DEFAULT_TOGGLES } from '../src/core/url-state.ts';

// NaN rather than a cast, as in url-state.spec.ts.
const ECLIPSE_2024_JD = parseUtc('2024-04-08 18:17:16') ?? Number.NaN;

describe('parseView tolerates a mangled query', () => {
  it('returns an empty view for an empty or contentless query', () => {
    expect(parseView('')).toEqual({});
    expect(parseView('?')).toEqual({});
  });

  it('ignores a rate that is not a non-zero number', () => {
    expect(parseView('?rate=fast').rate).toBeUndefined();
    expect(parseView('?rate=0').rate).toBeUndefined();
  });

  it('leaves the camera at its default for an out-of-range elevation', () => {
    expect(parseView('?el=999').elevation).toBeUndefined();
  });

  it('rejects a non-positive distance', () => {
    expect(parseView('?d=0').distanceRadii).toBeUndefined();
    expect(parseView('?d=-4').distanceRadii).toBeUndefined();
  });

  it('ignores an unrecognised enum value', () => {
    expect(parseView('?mode=metric').scaleMode).toBeUndefined();
    expect(parseView('?orbits=sometimes').orbits).toBeUndefined();
    expect(parseView('?labels=loud').labels).toBeUndefined();
    expect(parseView('?cam=teleport').cameraMode).toBeUndefined();
  });

  it('drops a free-flight vector of the wrong length or with a non-finite term', () => {
    expect(parseView('?fp=1,2').freePosition).toBeUndefined();
    expect(parseView('?fp=1,2,3,4').freePosition).toBeUndefined();
    expect(parseView('?fp=1,nan,3').freePosition).toBeUndefined();
  });

  it('treats an emptied number as missing rather than as zero', () => {
    const parsed = parseView('?az=&el=%20&d=');
    expect(parsed.azimuth).toBeUndefined();
    expect(parsed.elevation).toBeUndefined();
    expect(parsed.distanceRadii).toBeUndefined();
    expect(parseView('?fp=,,').freePosition).toBeUndefined();
    expect(parseView('?fq=1,,0,0').freeOrientation).toBeUndefined();
  });

  it('reads paused only from an explicit value', () => {
    expect(parseView('?paused=1').paused).toBe(true);
    expect(parseView('?paused=true').paused).toBe(true);
    expect(parseView('?paused=0').paused).toBe(false);
    expect(parseView('?paused=false').paused).toBe(false);
    expect(parseView('?paused=yes').paused).toBeUndefined();
  });

  it('reads the instant with or without its T and Z, in either case', () => {
    for (const t of ['2024-04-08T18:17:16Z', '2024-04-08 18:17:16', '2024-04-08t18:17:16z']) {
      expect(parseView(`?t=${encodeURIComponent(t)}`).jdUtc, t).toBeCloseTo(ECLIPSE_2024_JD, 6);
    }
  });

  it('ignores an instant on a day the calendar does not have', () => {
    expect(parseView('?t=2023-02-31T12:00:00Z').jdUtc).toBeUndefined();
  });

  it('drops a zero-length quaternion that cannot be normalised', () => {
    expect(parseView('?fq=0,0,0,0').freeOrientation).toBeUndefined();
  });

  it('does not let a typo in a toggle value switch the layer off', () => {
    expect(parseView('?belts=maybe').toggles).toBeUndefined();
  });

  it('merges a partial toggle set onto the defaults', () => {
    expect(parseView('?atmo=0&lagrange=0').toggles).toEqual({
      ...DEFAULT_TOGGLES,
      atmospheres: false,
      lagrange: false,
    });
  });

  it('still opens a truncated link, restoring only the readable half', () => {
    const parsed = parseView('?t=2024-04-08T18:17:16Z&focus=mars&rate=not');
    expect(parsed.focusKey).toBe('mars');
    expect(parsed.jdUtc).toBeCloseTo(ECLIPSE_2024_JD, 6);
    expect(parsed.rate).toBeUndefined();
  });

  it('ignores a retired parameter the way it ignores any unknown one', () => {
    expect(() => parseView('?orrery=0&focus=venus')).not.toThrow();
    expect(parseView('?orrery=0&focus=venus').focusKey).toBe('venus');
  });
});
