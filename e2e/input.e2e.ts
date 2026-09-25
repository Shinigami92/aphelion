/**
 * Keyboard and pointer input, end to end.
 *
 * Screenshots and pick maps open every view from a URL, so neither reaches the
 * input handlers. These drive real key presses and clicks and assert on the
 * state they leave behind, read through the `window.aphelion` handle and the
 * DOM. Desktop only: the shortcuts are keyboard shortcuts.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openView } from './fixtures.ts';

const EARTH = 't=2024-04-08T18:17:16Z&focus=earth&paused=1';

async function openEarth(page: Page): Promise<void> {
  await openView(page, EARTH);
  await page.waitForFunction(() => !window.aphelion.camera.isSettling, undefined, {
    timeout: 30_000,
  });
}

/** Runs in the page: the first grid point whose click would select something other than `avoid`. */
function findOtherBody(avoid: string): { x: number; y: number; key: string } {
  const { scene, system } = window.aphelion;
  const { width, height } = document.querySelector('canvas')!.getBoundingClientRect();
  for (let y = 10; y < height; y += 10) {
    for (let x = 10; x < width; x += 10) {
      const key = scene.pick(x, y, system)?.key;
      if (key !== undefined && key !== avoid) {
        return { x, y, key };
      }
    }
  }
  throw new Error('no other body on screen');
}

const toast = (page: Page): Promise<string | null> => page.locator('#toast').textContent();
const infoName = (page: Page): Promise<string | null> => page.locator('.info__name').textContent();
const focusKey = (page: Page): Promise<string> => page.evaluate(() => window.aphelion.focus.key);

test('clock shortcuts', async ({ page }) => {
  await openEarth(page);

  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.aphelion.time.paused)).toBe(false);
  expect(await toast(page)).toContain('Running');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.aphelion.time.paused)).toBe(true);

  await page.keyboard.press(']');
  await page.keyboard.press(']');
  expect(await page.evaluate(() => window.aphelion.time.rateIndex)).toBe(2);
  await page.keyboard.press('[');
  expect(await page.evaluate(() => window.aphelion.time.rateIndex)).toBe(1);

  await page.keyboard.press('j');
  expect(await page.evaluate(() => window.aphelion.time.direction)).toBe(-1);
  await page.keyboard.press('l');
  expect(await page.evaluate(() => window.aphelion.time.direction)).toBe(1);

  const before = await page.evaluate(() => window.aphelion.time.jdUtc);
  await page.keyboard.press('Space');
  await page.keyboard.press('.');
  expect(await page.evaluate(() => window.aphelion.time.jdUtc)).toBeGreaterThan(before);
});

test('display shortcuts', async ({ page }) => {
  await openEarth(page);
  const toggles = (): Promise<Record<string, unknown>> =>
    page.evaluate(() => ({ ...window.aphelion.scene.toggles }));

  await page.keyboard.press('o');
  expect((await toggles()).orbits).toBe('all');
  expect(await toast(page)).toBe('Orbits: all');
  await page.keyboard.press('o');
  expect((await toggles()).orbits).toBe('none');

  await page.keyboard.press('m');
  expect((await toggles()).labels).toBe('all');

  // One at a time: each key press has to land before the next is read.
  await page.keyboard.press('b');
  expect((await toggles()).belts).toBe(false);
  await page.keyboard.press('k');
  expect((await toggles()).rings).toBe(false);
  await page.keyboard.press('i');
  expect((await toggles()).atmospheres).toBe(false);
  await page.keyboard.press('x');
  expect((await toggles()).lagrange).toBe(false);
  // The view panel's checkboxes follow the keys.
  await expect(page.locator('#toggles .toggle--on')).toHaveCount(3);

  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.aphelion.scale.mode)).toBe('true');

  await page.keyboard.press('p');
  expect(await toast(page)).toBe('Quality: low');

  // The shareable URL catches up within its throttle.
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('orbits=none');
});

test('navigation shortcuts', async ({ page }) => {
  await openEarth(page);

  await page.keyboard.press('4');
  expect(await focusKey(page)).toBe('mars');
  expect(await infoName(page)).toBe('Mars');

  await page.keyboard.press('Tab');
  expect(await focusKey(page)).toBe('jupiter');
  await page.keyboard.press('Shift+Tab');
  expect(await focusKey(page)).toBe('mars');

  await page.keyboard.press('0');
  expect(await focusKey(page)).toBe('sun');

  await page.keyboard.press('Home');
  expect(await toast(page)).toBe('Whole system');

  await page.evaluate(() => window.aphelion.select('saturn'));
  await page.keyboard.press('g');
  expect(await focusKey(page)).toBe('saturn');
});

test('overlay, search and camera keys', async ({ page }) => {
  await openEarth(page);

  await page.keyboard.press('h');
  await expect(page.locator('#help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();

  await page.keyboard.press('v');
  expect(await page.evaluate(() => window.aphelion.camera.mode)).toBe('free');
  await page.keyboard.press('v');
  expect(await page.evaluate(() => window.aphelion.camera.mode)).toBe('orbit');

  await page.keyboard.down('w');
  expect(await page.evaluate(() => window.aphelion.camera.keys.forward)).toBe(true);
  await page.keyboard.up('w');
  expect(await page.evaluate(() => window.aphelion.camera.keys.forward)).toBe(false);

  await page.keyboard.down('ArrowLeft');
  expect(await page.evaluate(() => window.aphelion.camera.keys.orbitLeft)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.aphelion.camera.keys.orbitLeft)).toBe(false);
  await page.keyboard.up('ArrowLeft');

  await page.keyboard.press('/');
  await expect(page.locator('#browser input.search')).toBeFocused();
  // Typing in the search box must not trigger shortcuts.
  await page.keyboard.type('o');
  expect(await page.evaluate(() => window.aphelion.scene.toggles.orbits)).toBe('planets');
});

test('clicks select, double-clicks fly', async ({ page }) => {
  await openEarth(page);
  await page.evaluate(() => window.aphelion.select('sun'));
  expect(await infoName(page)).toBe('Sun');

  // Earth fills the middle of the view.
  const canvas = page.locator('#viewport');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  expect(await infoName(page)).toBe('Earth');

  // Somewhere else on screen that a click would resolve to another body. A
  // flight switches the focus the moment it starts, so there is no need to wait
  // for it to arrive.
  const target = await page.evaluate(findOtherBody, 'earth');
  await canvas.dblclick({ position: { x: target.x, y: target.y } });
  expect(await focusKey(page)).toBe(target.key);
});
