import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  plugins: [
    // Builds src/sw.ts into dist/sw.js with every emitted file and its content
    // hash injected; the worker itself decides what is precached and what is
    // cached on first use (see the comment at the top of src/sw.ts).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // src/sw-register.ts registers the worker itself, in production only.
      injectRegister: false,
      // public/manifest.webmanifest is hand-written and linked from index.html.
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,webmanifest,png,jpg,bin}'],
        // The largest maps are 15 MB. The build fails, rather than shipping a
        // worker that can't serve them offline, if one ever outgrows this.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        // sw-register.ts registers a classic worker, which can't hold `export`.
        rollupFormat: 'iife',
      },
    }),
  ],
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
