/**
 * Aphelion's service worker — what makes "open it on a plane" literally true.
 *
 * The app already issues no third-party requests: every script, texture and
 * ephemeris table is served from this origin. What was missing was surviving a
 * *reload* with no network, which needs the responses in a cache the worker can
 * serve from while offline.
 *
 * Navigations go network-first so a new deploy is picked up whenever the reader
 * is online. Everything else same-origin is stale-while-revalidate: imagery is
 * cached only once a flight has actually needed it, which is the right bargain
 * for a 110 MB media set. Cross-origin requests are left untouched — there
 * should be none.
 *
 * `CACHE_VERSION` is rewritten at build time (see vite.config.ts) so each
 * deploy drops the previous shell cache. The runtime cache is unversioned
 * and never swept, so a deploy doesn't cost the reader their imagery.
 */

const CACHE_VERSION = '__CACHE_VERSION__'
const SHELL_CACHE = `aphelion-shell-${CACHE_VERSION}`
const RUNTIME_CACHE = 'aphelion-runtime'

const APP_ASSETS = __APP_CHUNKS__

const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.png', ...APP_ASSETS]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('aphelion-shell-') && name !== SHELL_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function isAphelionHtml(body) {
  return body.includes('id="app"')
}

async function cacheIndexHtml(cache, response) {
  try {
    await cache.put('./index.html', response)
  } catch {}
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && isAphelionHtml(await response.clone().text())) {
      await cacheIndexHtml(cache, response.clone())
    }
    return response
  } catch {
    return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error()
  }
}

async function staleWhileRevalidate(event) {
  const { request } = event
  const cached = await caches.match(request)
  const runtime = await caches.open(RUNTIME_CACHE)

  const network = fetch(request)
    .then((response) => {
      if (response.ok) runtime.put(request, response.clone())
      return response
    })
    .catch(() => undefined)

  event.waitUntil(network)

  return cached ?? (await network) ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    request.mode === 'navigate' ? networkFirstShell(request) : staleWhileRevalidate(event),
  )
})
