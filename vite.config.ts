import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Rewrites the `__CACHE_VERSION__` and `__APP_CHUNKS__` placeholders in the
 * copied `public/sw.js`. The version only has to differ between deploys for
 * the old cache to be dropped: a commit SHA in CI, a timestamp locally. The
 * chunk list has to come from here because the hashed filenames (index-*.js,
 * three-*.js, index-*.css) aren't known until Rollup has named them.
 */
function stampServiceWorker(): Plugin {
  const version = process.env.GITHUB_SHA?.slice(0, 12) ?? `local-${Date.now()}`;
  return {
    name: 'aphelion:stamp-service-worker',
    apply: 'build',
    async writeBundle(options, bundle) {
      const appAssets = Object.values(bundle)
        .filter(
          (entry) => entry.fileName.startsWith('assets/') && /\.(js|css)$/.test(entry.fileName),
        )
        .map((entry) => `./${entry.fileName}`);

      const file = path.join(options.dir ?? 'dist', 'sw.js');
      const source = await readFile(file, 'utf8');
      const stamped = source
        .replace('__CACHE_VERSION__', version)
        .replace('__APP_CHUNKS__', JSON.stringify(appAssets));
      await writeFile(file, stamped);
    },
  };
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
    rolldownOptions: {
      output: {
        // Three.js is the bulk of the bundle and changes only on a dependency
        // bump; the app code changes every commit. Splitting them lets a deploy
        // reuse the cached (and service-worker-cached) Three chunk instead of
        // re-downloading it.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
