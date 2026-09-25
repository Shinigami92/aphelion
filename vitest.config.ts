import { defineConfig } from 'vitest/config';

// The suite under test/ exercises the pure modules — astronomy and view state,
// none of which touch the DOM or Three.js — so the default Node environment is
// all it needs. `pnpm validate` still owns the slow reference-value checks
// against real ephemerides; this is the fast inner loop for the invariants.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // Shuffled so a test that only passes after another one has warmed some
    // shared module state fails loudly instead of hiding.
    sequence: {
      shuffle: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['clover', 'cobertura', 'lcov', 'text'],
      // Only the layers that are pure functions of their input. render/, ui/
      // and controls/ need a WebGL context and a DOM, so they are not measured.
      include: ['src/astro', 'src/core', 'src/data'],
      exclude: ['src/data/generated'],
    },
    reporters: process.env.CI_PREFLIGHT
      ? ['default', 'github-actions']
      : [['default', { summary: false }]],
  },
});
