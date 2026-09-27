/**
 * Viewing the scene in a VR headset, through WebXR.
 *
 * The button only appears where a headset can actually be used — the browser
 * has to report `immersive-vr` as supported — so a desktop without one, a phone
 * or a tablet sees no change at all. Nothing else stops while a session runs:
 * the page, the panels, the keyboard and the mouse all drive the same camera
 * the headset rides on, so whoever sits at the desk can steer for whoever wears
 * it.
 *
 * Nothing here is fetched. Three.js's stock controller models come from a CDN,
 * which an offline app cannot use, so the controllers are drawn as plain
 * pointer rays instead (render/scene/xr-rig.ts).
 */

import type { XrInputDeps } from './xr-input.ts';
import { el } from '../ui/panels/dom.ts';
import { XrInput } from './xr-input.ts';

export interface XrDeps extends XrInputDeps {
  /** Where the Enter VR button goes. */
  host: HTMLElement;
  /** Called once a session has ended and the canvas is the renderer's again. */
  onSessionEnd: () => void;
}

const ENTER = 'Enter VR';
const EXIT = 'Exit VR';

async function startSession(deps: XrDeps, button: HTMLButtonElement): Promise<void> {
  const xr = navigator.xr;
  if (!xr) {
    return;
  }
  try {
    // Projection layers are what Three.js draws into when the browser has
    // them, and optional so that one without them still gets a session.
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['layers'] });
    session.addEventListener('end', () => {
      button.textContent = ENTER;
      deps.onSessionEnd();
    });
    await deps.scene.xr.start(session);
    button.textContent = EXIT;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.toast.show(`VR could not start: ${reason}`, 4000);
  }
}

async function toggleSession(deps: XrDeps, button: HTMLButtonElement): Promise<void> {
  const session = deps.scene.xr.session;
  await (session ? session.end() : startSession(deps, button));
}

/** Add the Enter VR button if this browser can reach a headset. */
async function offerVr(deps: XrDeps): Promise<void> {
  const supported = await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false);
  if (supported !== true) {
    return;
  }
  const button = el('button', 'btn btn--wide', ENTER);
  button.title = 'View in a VR headset (WebXR)';
  button.addEventListener('click', () => {
    void toggleSession(deps, button);
  });
  const row = el('div', 'segmented');
  row.append(button);
  deps.host.append(row);
}

/** Offer VR where it is available, and return the controllers' per-frame reader. */
export function installXr(deps: XrDeps): XrInput {
  void offerVr(deps);
  return new XrInput(deps);
}
