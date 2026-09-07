/**
 * Registers `public/sw.js`, production only — in dev it would cache module
 * requests behind Vite's back and break HMR.
 *
 * With `base: './'` the worker URL resolves against the document, so it works
 * both at the site root and under the `/aphelion/` path GitHub Pages serves
 * from. `updateViaCache: 'none'` stops the browser serving a stale worker
 * script from its own HTTP cache.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .catch((error) => {
        console.warn('Service worker registration failed; the app still runs online.', error)
      })
  })
}
