/** Reading a shared view back out of a query string. */

import type { SharedView, ViewToggles } from './url-state.ts';
import { parseUtc } from '../astro/calendar.ts';
import {
  CAMERA_MODES,
  DEFAULT_TOGGLES,
  isOneOf,
  LABEL_MODES,
  ORBIT_MODES,
  SCALE_MODES,
  TOGGLE_PARAMS,
} from './url-state.ts';
// ---------------------------------------------------------------------------

/**
 * Read a shared view out of a query string.
 *
 * Every field is optional and every malformed field is ignored rather than
 * throwing: a hand-edited or truncated link should still open the app, just with
 * fewer things restored.
 */
export function parseView(search: string): Partial<SharedView> {
  const q = new URLSearchParams(search);
  const out: Partial<SharedView> = {};

  readClock(q, out);
  readSelection(q, out);
  readCamera(q, out);
  readDisplay(q, out);
  return out;
}

/** The instant, the rate and whether the clock is running. */
function readClock(q: URLSearchParams, out: Partial<SharedView>): void {
  const t = q.get('t');
  if (t !== null && t !== '') {
    const jd = parseUtc(t.replace('T', ' ').replace(/Z$/iu, ''));
    if (jd !== null) {
      out.jdUtc = jd;
    }
  }

  const rate = q.get('rate');
  if (rate !== null) {
    const value = Number(rate);
    if (Number.isFinite(value) && value !== 0) {
      out.rate = value;
    }
  }

  const paused = q.get('paused');
  if (paused !== null) {
    out.paused = paused === '1' || paused === 'true';
  }
}

/** What is focused and selected, and in which scale. */
function readSelection(q: URLSearchParams, out: Partial<SharedView>): void {
  const focus = q.get('focus');
  if (focus !== null && focus !== '') {
    out.focusKey = focus;
  }
  const sel = q.get('sel');
  if (sel !== null && sel !== '') {
    out.selectedKey = sel;
  }

  const mode = q.get('mode');
  if (mode !== null && isOneOf(SCALE_MODES, mode)) {
    out.scaleMode = mode;
  }
}

/** Where the camera is: orbit angles and range, or a free-flight pose. */
function readCamera(q: URLSearchParams, out: Partial<SharedView>): void {
  const az = numberParam(q, 'az');
  if (az !== undefined) {
    out.azimuth = az;
  }
  // Elevation is bounded by geometry, so anything outside the range is garbage
  // rather than something to clamp — `el=999` should leave the default alone, not
  // silently pin the camera over the pole.
  const el = numberParam(q, 'el');
  if (el !== undefined && Math.abs(el) <= Math.PI / 2) {
    out.elevation = el;
  }
  const d = numberParam(q, 'd');
  if (d !== undefined && d > 0) {
    out.distanceRadii = d;
  }

  const cam = q.get('cam');
  if (cam !== null && isOneOf(CAMERA_MODES, cam)) {
    out.cameraMode = cam;
  }

  const fp = vectorParam(q, 'fp', 3);
  if (fp) {
    out.freePosition = [fp[0], fp[1], fp[2]];
  }
  const fq = vectorParam(q, 'fq', 4);
  // A zero-length quaternion cannot be normalised into a rotation.
  if (fq && Math.hypot(fq[0], fq[1], fq[2], fq[3]) > 1e-6) {
    out.freeOrientation = [fq[0], fq[1], fq[2], fq[3]];
  }
}

/** Orbit and label modes, and the layer switches. */
function readDisplay(q: URLSearchParams, out: Partial<SharedView>): void {
  const orbits = q.get('orbits');
  if (orbits !== null && isOneOf(ORBIT_MODES, orbits)) {
    out.orbits = orbits;
  }
  const labels = q.get('labels');
  if (labels !== null && isOneOf(LABEL_MODES, labels)) {
    out.labels = labels;
  }

  const toggles: Partial<ViewToggles> = {};
  let sawToggle = false;
  for (const [key, param] of TOGGLE_PARAMS) {
    const raw = q.get(param);
    if (raw === null) {
      continue;
    }
    // Only explicit values count. Treating anything unrecognised as false let a
    // typo silently switch a layer off, which is the opposite of the
    // ignore-what-you-cannot-parse rule the rest of the parser follows.
    if (raw === '1' || raw === 'true') {
      toggles[key] = true;
    } else if (raw === '0' || raw === 'false') {
      toggles[key] = false;
    } else {
      continue;
    }
    sawToggle = true;
  }
  if (sawToggle) {
    out.toggles = { ...DEFAULT_TOGGLES, ...toggles };
  }
}

/** A finite number, or undefined if the parameter is missing or is anything else. */
function numberParam(q: URLSearchParams, name: string): number | undefined {
  const raw = q.get(name);
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** A fixed-length list of finite numbers, or undefined if it is anything else. */
function vectorParam(q: URLSearchParams, name: string, length: number): number[] | undefined {
  const raw = q.get(name);
  if (raw === null) {
    return undefined;
  }
  const parts = raw.split(',').map(Number);
  if (parts.length !== length || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return parts;
}
