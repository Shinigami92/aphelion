/**
 * The view, encoded in the URL.
 *
 * Everything needed to reconstruct what someone is looking at goes in the query
 * string, so a link can be pasted into a chat and land the recipient on the same
 * body, at the same instant, from the same angle — and so a reload is a no-op
 * rather than a reset.
 *
 * Two deliberate choices:
 *
 *   - **Camera distance is stored in radii of the focused body**, not kilometres
 *     or scene units. Radii are exact in both scale modes (a body and its
 *     surroundings scale uniformly), so the same link frames the body identically
 *     whether the recipient lands in explore or true scale.
 *   - **Only non-default values are written.** The default view is a bare URL,
 *     and a shared link stays short enough to read.
 *
 * Reading a link is in url-parse.ts and writing the address bar in url-writer.ts.
 *
 * Writes go through `history.replaceState`, never `pushState`: with a live clock
 * the state changes every second and pushing would bury the back button.
 */

import { formatUtc } from '../astro/calendar.ts';

// These mirror the unions in render/scene/types.ts and core/scale.ts. They are
// redeclared rather than imported so this module stays free of the render layer;
// TypeScript's structural typing makes them assignable in both directions.
export const ORBIT_MODES = ['none', 'planets', 'all'] as const;
export const LABEL_MODES = ['none', 'major', 'all'] as const;
export const SCALE_MODES = ['explore', 'true'] as const;
export const CAMERA_MODES = ['orbit', 'free'] as const;

export type UrlOrbitMode = (typeof ORBIT_MODES)[number];
export type UrlLabelMode = (typeof LABEL_MODES)[number];
export type UrlScaleMode = (typeof SCALE_MODES)[number];
export type UrlCameraMode = (typeof CAMERA_MODES)[number];

export interface ViewToggles {
  belts: boolean;
  rings: boolean;
  atmospheres: boolean;
  milkyway: boolean;
  minorBodies: boolean;
  lagrange: boolean;
}

export interface SharedView {
  /** UTC Julian Date. */
  jdUtc: number;
  focusKey: string;
  /** Only meaningful when it differs from the focus. */
  selectedKey: string | null;
  scaleMode: UrlScaleMode;
  /** Signed simulated seconds per real second. */
  rate: number;
  paused: boolean;
  /** Camera azimuth and elevation about the focus, radians. */
  azimuth: number;
  elevation: number;
  /** Camera distance from the focus centre, in radii of the focused body. */
  distanceRadii: number;
  /** Whether the camera is orbiting the focus or flying free. */
  cameraMode: UrlCameraMode;
  /**
   * Free-flight position relative to the focus, in radii of the focused body,
   * and orientation as a quaternion. Null unless the camera is flying free.
   *
   * Radii for the same reason `distanceRadii` uses them: a free camera parked
   * beside a moon has to arrive beside that moon whichever scale mode the
   * recipient opens the link in. The orientation is stored outright rather than
   * as a look-at target, because in free flight where you are pointing is not
   * derivable from anything else — that is the whole difference from orbit mode,
   * and losing it is what made a reload snap back to facing the focus.
   */
  freePosition: readonly [number, number, number] | null;
  freeOrientation: readonly [number, number, number, number] | null;
  orbits: UrlOrbitMode;
  labels: UrlLabelMode;
  toggles: ViewToggles;
}

export const DEFAULT_ORBITS: UrlOrbitMode = 'planets';
export const DEFAULT_LABELS: UrlLabelMode = 'major';
export const DEFAULT_TOGGLES: ViewToggles = {
  belts: true,
  rings: true,
  atmospheres: true,
  milkyway: true,
  minorBodies: true,
  lagrange: true,
};

/**
 * Query parameter name for each boolean toggle.
 *
 * `orrery` used to be one of these, back when the map had a checkbox of its own;
 * it folds away with every other panel now, and a link carrying the old
 * parameter is ignored the same way any other unknown one is.
 */
export const TOGGLE_PARAMS: ReadonlyArray<readonly [keyof ViewToggles, string]> = [
  ['belts', 'belts'],
  ['rings', 'rings'],
  ['atmospheres', 'atmo'],
  ['milkyway', 'milkyway'],
  ['minorBodies', 'minor'],
  ['lagrange', 'lagrange'],
];

/**
 * Percent-encode, but leave `:` legible. Body keys look like `moon:Io`, and a URL
 * full of `%3A` is unpleasant to read in a chat window. Colons are legal in a
 * query string; spaces (minor planets such as `sb:2002 MS4`) still get encoded.
 */
const enc = (s: string): string => encodeURIComponent(s).replaceAll(/%3A/giu, ':');

/** Narrow a query value to one of a fixed set of options without a cast. */
export function isOneOf<T extends string>(options: ReadonlyArray<T>, value: string): value is T {
  return options.some((option) => option === value);
}

const round = (x: number, places = 4): number => Number(x.toFixed(places));

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export function encodeView(v: SharedView): string {
  const parts: string[] = [
    // `YYYY-MM-DDTHH:MM:SSZ` — second precision, which is also how often a live
    // clock changes the URL.
    `t=${enc(`${formatUtc(v.jdUtc).replace(' ', 'T')}Z`)}`,
    `focus=${enc(v.focusKey)}`,
  ];
  if (v.selectedKey !== null && v.selectedKey !== '' && v.selectedKey !== v.focusKey) {
    parts.push(`sel=${enc(v.selectedKey)}`);
  }
  if (v.scaleMode !== 'explore') {
    parts.push(`mode=${v.scaleMode}`);
  }
  parts.push(`rate=${v.rate}`);
  if (v.paused) {
    parts.push('paused=1');
  }
  parts.push(
    `az=${round(v.azimuth)}`,
    `el=${round(v.elevation)}`,
    `d=${round(v.distanceRadii, 3)}`,
  );
  if (v.cameraMode === 'free') {
    parts.push('cam=free');
    // Six places, not the usual four. In radii of the focused body, four places
    // is ~36 km at Saturn — invisible for a planet, but enough to drop you
    // beside a different boulder when you were parked in the rings.
    if (v.freePosition) {
      parts.push(`fp=${v.freePosition.map((n) => round(n, 6)).join(',')}`);
    }
    if (v.freeOrientation) {
      parts.push(`fq=${v.freeOrientation.map((n) => round(n, 5)).join(',')}`);
    }
  }
  if (v.orbits !== DEFAULT_ORBITS) {
    parts.push(`orbits=${v.orbits}`);
  }
  if (v.labels !== DEFAULT_LABELS) {
    parts.push(`labels=${v.labels}`);
  }
  for (const [key, param] of TOGGLE_PARAMS) {
    if (v.toggles[key] !== DEFAULT_TOGGLES[key]) {
      parts.push(`${param}=${v.toggles[key] ? 1 : 0}`);
    }
  }

  return parts.join('&');
}
