/**
 * The view encoded in the URL.
 *
 * The module had no coverage and a lot of surface: a "write only non-defaults"
 * encoder and an "ignore anything you cannot parse" decoder that have to stay in
 * agreement. The contract worth pinning down:
 *
 *   - encode → parse is a faithful round trip (within the documented rounding);
 *   - a hand-mangled query still opens, just with fewer fields restored;
 *   - a typo never silently switches a layer off.
 */

import type { SharedView } from '../src/core/url-state.ts';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUtc } from '../src/astro/calendar.ts';
import { RATE_PRESETS } from '../src/core/time.ts';
import { rateToPreset } from '../src/core/time.ts';
import { parseView } from '../src/core/url-parse.ts';
import {
  DEFAULT_LABELS,
  DEFAULT_ORBITS,
  DEFAULT_TOGGLES,
  encodeView,
} from '../src/core/url-state.ts';
import { UrlWriter } from '../src/core/url-writer.ts';

// NaN rather than a cast: should the fixture ever stop parsing, every
// comparison against it fails instead of quietly testing `null`.
const ECLIPSE_2024_JD = parseUtc('2024-04-08 18:17:16') ?? Number.NaN;

const baseView = (over: Partial<SharedView> = {}): SharedView => ({
  jdUtc: ECLIPSE_2024_JD,
  focusKey: 'earth',
  selectedKey: null,
  scaleMode: 'explore',
  rate: 1,
  paused: false,
  azimuth: 1.2345,
  elevation: 0.321,
  distanceRadii: 25.4,
  cameraMode: 'orbit',
  freePosition: null,
  freeOrientation: null,
  orbits: DEFAULT_ORBITS,
  labels: DEFAULT_LABELS,
  toggles: { ...DEFAULT_TOGGLES },
  ...over,
});

/** Every field of `original` survives an encode → parse cycle, allowing for rounding. */
const expectFaithfulRoundTrip = (original: SharedView): void => {
  const parsed = parseView(`?${encodeView(original)}`);

  expect(parsed.jdUtc).toBeCloseTo(original.jdUtc, 4);
  expect(parsed.focusKey).toBe(original.focusKey);
  expect(parsed.scaleMode ?? 'explore').toBe(original.scaleMode);
  expect(parsed.rate ?? 1).toBe(original.rate);
  expect(parsed.paused ?? false).toBe(original.paused);
  expect(parsed.azimuth).toBeCloseTo(original.azimuth, 3);
  expect(parsed.elevation).toBeCloseTo(original.elevation, 3);
  expect(parsed.distanceRadii).toBeCloseTo(original.distanceRadii, 2);
  expect(parsed.orbits ?? DEFAULT_ORBITS).toBe(original.orbits);
  expect(parsed.labels ?? DEFAULT_LABELS).toBe(original.labels);
  expect({ ...DEFAULT_TOGGLES, ...parsed.toggles }).toEqual(original.toggles);

  if (original.cameraMode === 'free') {
    expect(parsed.cameraMode).toBe('free');
    expect(parsed.freePosition?.[0]).toBeCloseTo(original.freePosition![0], 5);
    expect(parsed.freeOrientation?.[3]).toBeCloseTo(original.freeOrientation![3], 4);
  }

  if (
    original.selectedKey !== null &&
    original.selectedKey !== '' &&
    original.selectedKey !== original.focusKey
  ) {
    expect(parsed.selectedKey).toBe(original.selectedKey);
  }
};

describe('encode → parse is a faithful round trip', () => {
  it('for the default view', () => {
    expectFaithfulRoundTrip(baseView());
  });

  it('for true scale, paused, running backwards', () => {
    expectFaithfulRoundTrip(baseView({ scaleMode: 'true', paused: true, rate: -86_400 }));
  });

  it('for a selection distinct from the focus', () => {
    expectFaithfulRoundTrip(baseView({ focusKey: 'jupiter', selectedKey: 'moon:Europa' }));
  });

  it('for every display layer switched off', () => {
    expectFaithfulRoundTrip(
      baseView({
        orbits: 'all',
        labels: 'all',
        toggles: {
          belts: false,
          rings: false,
          atmospheres: false,
          milkyway: false,
          minorBodies: false,
          lagrange: false,
        },
      }),
    );
  });

  it('for free flight with a position and orientation', () => {
    expectFaithfulRoundTrip(
      baseView({
        cameraMode: 'free',
        freePosition: [12.345678, -0.5, 3.25159],
        freeOrientation: [0.1, 0.2, 0.3, 0.9],
      }),
    );
  });
});

describe('encodeView keeps the URL short and readable', () => {
  it('omits every field that is still at its default', () => {
    const q = encodeView(baseView());
    expect(q).not.toMatch(/(^|&)(sel|mode|paused|cam|fp|fq|orbits|labels|belts|rings|atmo)=/u);
  });

  it('writes a field once it departs from the default', () => {
    const q = encodeView(
      baseView({
        selectedKey: 'moon:Io',
        scaleMode: 'true',
        paused: true,
        orbits: 'all',
        toggles: { ...DEFAULT_TOGGLES, atmospheres: false },
      }),
    );
    expect(q).toContain('sel=moon:Io');
    expect(q).toContain('mode=true');
    expect(q).toContain('paused=1');
    expect(q).toContain('orbits=all');
    expect(q).toContain('atmo=0');
  });

  it('keeps colons legible but encodes spaces in body keys', () => {
    expect(encodeView(baseView({ focusKey: 'sb:2002 MS4' }))).toContain('focus=sb:2002%20MS4');
  });
});

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

describe('rateToPreset', () => {
  it('snaps every exact preset back to its own index, running forward', () => {
    RATE_PRESETS.forEach((preset, index) => {
      expect(rateToPreset(preset.secondsPerSecond), preset.label).toEqual({ index, direction: 1 });
    });
  });

  it('carries a negative sign into the direction, not the index', () => {
    const dayPerSecondIndex = RATE_PRESETS.findIndex((p) => p.secondsPerSecond === 86_400);
    expect(rateToPreset(-86_400)).toEqual({ index: dayPerSecondIndex, direction: -1 });
  });

  it('chooses the nearer rung on a log scale for an in-between value', () => {
    const oneHourIndex = RATE_PRESETS.findIndex((p) => p.secondsPerSecond === 3600);
    expect(rateToPreset(2000).index).toBe(oneHourIndex);
  });

  it('treats a zero rate as the slowest preset', () => {
    expect(rateToPreset(0)).toEqual({ index: 0, direction: 1 });
  });
});

/** Node has no `window`; the writer only ever touches these two members. */
const stubWindow = (): Mock<History['replaceState']> => {
  const replaceState = vi.fn<History['replaceState']>();
  vi.stubGlobal('window', { location: { pathname: '/aphelion/' }, history: { replaceState } });
  return replaceState;
};

describe('UrlWriter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the encoded view under the current path', () => {
    const replaceState = stubWindow();
    const view = baseView();
    new UrlWriter().sync(1000, () => view);
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      null,
      '',
      `/aphelion/?${encodeView(view)}`,
    );
  });

  it('throttles to one rebuild per interval and skips an unchanged query', () => {
    const replaceState = stubWindow();
    const writer = new UrlWriter(400);
    const snapshot = vi.fn<() => SharedView>(() => baseView());

    writer.sync(1000, snapshot);
    writer.sync(1200, snapshot);
    expect(snapshot).toHaveBeenCalledTimes(1);

    writer.sync(1400, snapshot);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately, ignoring the throttle', () => {
    const replaceState = stubWindow();
    const writer = new UrlWriter(400);
    writer.sync(1000, () => baseView());
    writer.flush(() => baseView({ focusKey: 'mars' }));
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(replaceState.mock.lastCall?.[2]).toContain('focus=mars');
  });
});
