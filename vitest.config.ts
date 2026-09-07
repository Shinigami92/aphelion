import { defineConfig } from 'vitest/config'

// The suite under test/ exercises the pure modules — astronomy and view state,
// none of which touch the DOM or Three.js — so the default Node environment is
// all it needs. `pnpm validate` still owns the slow reference-value checks
// against real ephemerides; this is the fast inner loop for the invariants.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
