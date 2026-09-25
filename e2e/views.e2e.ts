/**
 * Fixed views, each opened from a shared link so the whole state (instant,
 * focus, camera, scale, layers) comes from the URL and nothing depends on the
 * wall clock. Every link is paused; the only motion left is the camera easing
 * in, which `toHaveScreenshot` waits out by requiring two identical frames.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

interface View {
  name: string;
  query: string;
}

const VIEWS: ReadonlyArray<View> = [
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

/** Open a view and wait until the boot veil is gone and every texture has loaded. */
async function openView(page: Page, query: string): Promise<void> {
  await page.goto(`./?${query}`);
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

for (const view of VIEWS) {
  test(view.name, async ({ page }) => {
    await openView(page, view.query);
    await expect(page).toHaveScreenshot(`${view.name}.png`, {
      stylePath: fileURLToPath(new URL('screenshot.css', import.meta.url)),
      // SwiftShader takes a while per frame at desktop size.
      timeout: 60_000,
    });
  });
}
