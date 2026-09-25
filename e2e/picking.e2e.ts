/**
 * The hit test, which screenshots cannot see.
 *
 * For each fixed view, `scene.pick()` is asked what a click would select at
 * every point of a grid over the canvas, through the `window.aphelion` handle
 * the app exposes for exactly this kind of scripting. The resulting map of body
 * keys is compared as text, so a refactor that changes what a click means —
 * occlusion, the cluster rule, which layers are aimable — shows up as the cells
 * that changed.
 */

import { expect, test } from '@playwright/test';
import { openView, VIEWS } from './fixtures.ts';

const COLUMNS = 24;
const ROWS = 15;

/**
 * Runs in the page: what a click would select at each grid cell's centre, as
 * one row of body keys per line ('-' where nothing would be).
 */
function samplePickMap([columns, rows]: readonly [number, number]): string {
  const { scene, system } = window.aphelion;
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    throw new Error('no canvas');
  }
  const { width, height } = canvas.getBoundingClientRect();
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const keys: string[] = [];
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) / columns) * width;
      const y = ((row + 0.5) / rows) * height;
      keys.push(scene.pick(x, y, system)?.key ?? '-');
    }
    lines.push(keys.join(' '));
  }
  return lines.join('\n');
}

for (const view of VIEWS) {
  test(`pick map: ${view.name}`, async ({ page }) => {
    await openView(page, view.query);
    // The camera eases in on load; picking before it settles would sample a
    // moving scene. A few idle frames after that let the layers catch up.
    await page.waitForFunction(() => !window.aphelion.camera.isSettling, undefined, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);

    const map = await page.evaluate(samplePickMap, [COLUMNS, ROWS] as const);

    expect(map).toMatchSnapshot(`pick-${view.name}.txt`);
  });
}
