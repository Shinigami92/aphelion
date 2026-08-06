import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    // Textures are already compressed; don't inline anything binary.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
  },
})
