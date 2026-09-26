/**
 * The fixed views both guards open, each from a shared link so the whole state
 * (instant, focus, camera, scale, layers) comes from the URL and nothing
 * depends on the wall clock. Every link is paused.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

declare global {
  interface Window {
    /** Set by `pace`: while true, no animation frame callback runs. */
    __e2eFrozen?: boolean;
  }
}

export interface View {
  name: string;
  query: string;
}

export const VIEWS: ReadonlyArray<View> = [
  { name: 'earth-explore', query: 't=2024-04-08T18:17:16Z&focus=earth&paused=1' },
  {
    name: 'earth-true-scale',
    query: 't=2024-04-08T18:17:16Z&focus=earth&mode=true&paused=1',
  },
  // The 2024 total eclipse: the Moon's shadow on Earth and the eclipse geometry.
  {
    name: 'eclipse-2024',
    query: 't=2024-04-08T18:17:16Z&focus=earth&az=0.333&el=0.3&d=3&paused=1',
  },
  // Rings: the ring material, ring shadow on the planet, ring particles.
  {
    name: 'saturn-rings',
    query: 't=2024-04-08T18:17:16Z&focus=saturn&sel=saturn&el=0.35&d=5&paused=1',
  },
  // Atmosphere and cloud shells, plus the Galilean moons.
  {
    name: 'jupiter-moons',
    query: 't=2024-04-08T18:17:16Z&focus=jupiter&sel=jupiter&d=40&paused=1',
  },
  // Lagrange markers and the lagrange info panel.
  {
    name: 'earth-l2',
    query: 't=2024-04-08T18:17:16Z&focus=lagrange:earth:L2&sel=lagrange:earth:L2&paused=1',
  },
  // A minor body: point sprites, belt swarm and the minimap.
  { name: 'ceres-belt', query: 't=2024-04-08T18:17:16Z&focus=ceres&sel=ceres&d=4000&paused=1' },
  // Whole system from far out: orbits, labels, the Kuiper belt.
  { name: 'system-overview', query: 't=2024-04-08T18:17:16Z&focus=sun&d=60000&paused=1' },
];

/**
 * Runs in the page before any of its scripts: hold every animation frame until
 * the GPU has finished the last one.
 *
 * A full-quality frame costs SwiftShader most of a second at desktop size, and
 * the frame governor still asks for ten a second while idle. Left alone, the
 * GPU process falls seconds behind, and every screenshot reads pixels back only
 * once that whole queue has drained — about 12 s a capture. A fence polled each
 * frame keeps at most one frame in flight without blocking the main thread, so
 * texture decodes and the test's own calls still get through.
 */
function pace(): void {
  let gl: WebGL2RenderingContext | null = null;
  // Asking a canvas for the kind of context it already has returns that same
  // context, but asking first would create one with the wrong attributes, so
  // wait for the scripting handle: it is installed after the renderer.
  function context(): WebGL2RenderingContext | null {
    if (gl === null && 'aphelion' in window) {
      gl = document.querySelector<HTMLCanvasElement>('#viewport')?.getContext('webgl2') ?? null;
    }
    return gl;
  }

  let fence: WebGLSync | null = null;
  function gpuCaughtUp(): boolean {
    if (gl === null || fence === null) {
      return true;
    }
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
      return false;
    }
    gl.deleteSync(fence);
    fence = null;
    return true;
  }

  const requestFrame = window.requestAnimationFrame.bind(window);
  window.__e2eFrozen = false;
  window.requestAnimationFrame = (callback) =>
    requestFrame((now) => {
      if (window.__e2eFrozen === true || !gpuCaughtUp()) {
        window.requestAnimationFrame(callback);
        return;
      }
      callback(now);
      const webgl = context();
      if (webgl !== null && fence === null) {
        fence = webgl.fenceSync(webgl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        webgl.flush();
      }
    });
}

/** Open a view and wait until the boot veil is gone and every texture has loaded. */
export async function openView(page: Page, query: string): Promise<void> {
  await page.addInitScript(pace);
  await page.goto(`./?${query}`);
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for the camera to finish easing in, then for a couple of frames drawn
 * after that, so the layers have caught up with the final camera and every
 * texture that arrived during the ease is on screen.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => !window.aphelion.camera.isSettling, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        const { scene } = window.aphelion;
        const render = scene.render.bind(scene);
        let left = frames;
        scene.render = (camera) => {
          render(camera);
          left--;
          if (left === 0) {
            resolve();
          }
        };
      }),
    2,
  );
}

/**
 * Stop the frame loop, leaving the last drawn frame on screen. A paused view
 * that has settled would redraw the same pixels anyway; stopping it means a
 * screenshot no longer shares SwiftShader with the renderer.
 */
export async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__e2eFrozen = true;
  });
}
