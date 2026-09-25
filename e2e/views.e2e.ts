/**
 * Screenshots of the fixed views. The only motion left in a paused view is the
 * camera easing in, which `toHaveScreenshot` waits out by requiring two
 * identical frames.
 */

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openView, VIEWS } from './fixtures.ts';

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
