import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot baselines of fixed views, as a guard for refactors of the render,
 * UI and controls layers — the ones the Vitest suite cannot reach without a
 * WebGL context.
 *
 * Local only, and the baselines are not committed: WebGL output differs between
 * GPUs, drivers and operating systems, so a baseline is only meaningful on the
 * machine that took it. The workflow is `pnpm screenshots:update` on the commit
 * before a refactor, then `pnpm screenshots` after it.
 *
 * Rendering is forced onto SwiftShader so the pixels depend on the CPU rasteriser
 * rather than on whatever GPU the machine happens to have, which keeps repeated
 * runs identical.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  snapshotPathTemplate: '.cache/screenshots/{projectName}/{arg}{ext}',
  outputDir: '.cache/screenshots-results',
  // SwiftShader rasterises on the CPU and uses every core it can get. The frame
  // pacing in e2e/fixtures.ts keeps each page from queueing more than it can
  // draw, so a few pages share the cores well; past four the gain is marginal.
  workers: 4,
  forbidOnly: true,
  reporter: [['list']],
  timeout: 90_000,
  expect: {
    toHaveScreenshot: {
      // Real regressions (a missing shadow, a swapped texture, a shifted panel)
      // move thousands of pixels; this only absorbs antialiasing noise.
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:5174/',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Device scale 1: the phone layout keys off the viewport width, and at the
    // Pixel's native 2.6 SwiftShader has seven times the pixels to fill per frame.
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
      // Keyboard shortcuts are a desktop affordance.
      testIgnore: '**/input.e2e.ts',
    },
  ],
  webServer: {
    // Its own port, so a `pnpm dev` already running on 5173 is left alone.
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174/',
    reuseExistingServer: false,
  },
});
