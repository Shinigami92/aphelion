import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Rewrites the `__CACHE_VERSION__` placeholder in the copied `public/sw.js`.
 * The value only has to differ between deploys for the old cache to be dropped:
 * a commit SHA in CI, a timestamp locally.
 */
function stampServiceWorker(): Plugin {
  const version = (process.env.GITHUB_SHA ?? `local-${Date.now()}`).slice(0, 12)
  return {
    name: 'aphelion:stamp-service-worker',
    apply: 'build',
    async writeBundle(options) {
      const file = path.join(options.dir ?? 'dist', 'sw.js')
      const source = await readFile(file, 'utf8')
      await writeFile(file, source.replace('__CACHE_VERSION__', version))
    },
  }
}

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  plugins: [stampServiceWorker()],
  build: {
    target: 'es2022',
    // Textures are already compressed; don't inline anything binary.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // Three.js is the bulk of the bundle and changes only on a dependency
        // bump; the app code changes every commit. Splitting them lets a deploy
        // reuse the cached (and service-worker-cached) Three chunk instead of
        // re-downloading it.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
})
