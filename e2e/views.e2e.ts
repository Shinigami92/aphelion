/**
 * Screenshots of the fixed views. The only motion in a paused view is the
 * camera easing in; once it has settled the frame loop is stopped, so the
 * capture is of one finished frame rather than a race with the renderer.
 */

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { freeze, openView, settle, VIEWS } from './fixtures.ts';

for (const view of VIEWS) {
  test(view.name, async ({ page }) => {
    await openView(page, view.query);
    await settle(page);
    await freeze(page);
    await expect(page).toHaveScreenshot(`${view.name}.png`, {
      stylePath: fileURLToPath(new URL('screenshot.css', import.meta.url)),
    });
  });
}
