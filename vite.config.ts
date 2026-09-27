import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Modules only a VR session loads: the headset UI, its library and its fonts.
 * Their chunks go to assets/vr/, which the service worker caches on first use
 * instead of precaching (see src/sw.ts), so a visitor without a headset never
 * downloads them. That includes the pieces of the library Aphelion never loads
 * at all (a default font, a runtime font generator and its worker).
 */
const VR_ONLY = [
  '/src/ui/xr/',
  '/src/data/generated/fonts/',
  '/node_modules/@pmndrs/',
  '/node_modules/@zappar/',
  '/node_modules/@preact/',
  '/node_modules/yoga-layout/',
  '/node_modules/zod/',
];

const isVrOnly = (id: string | null | undefined): boolean =>
  id != null && VR_ONLY.some((part) => id.replaceAll('\\', '/').includes(part));

/** Where a chunk made of `moduleIds` is written. */
const chunkPath = (moduleIds: ReadonlyArray<string>): string =>
  moduleIds.length > 0 && moduleIds.every(isVrOnly)
    ? 'assets/vr/[name]-[hash].js'
    : 'assets/[name]-[hash].js';

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
        chunkFileNames: (chunk) => chunkPath(chunk.moduleIds),
        // The font generator's worker arrives as a file of its own.
        assetFileNames: (asset) =>
          asset.originalFileNames.some(isVrOnly)
            ? 'assets/vr/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
