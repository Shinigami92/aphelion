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
 * `CACHE_VERSION` is rewritten at build time (see vite.config.ts) so each deploy
 * drops the previous cache.
 */

const CACHE_VERSION = '__CACHE_VERSION__'
const CACHE_NAME = `aphelion-${CACHE_VERSION}`

const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    cache.put('./index.html', response.clone())
    return response
  } catch {
    return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)

  return cached ?? (await network) ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    request.mode === 'navigate' ? networkFirstShell(request) : staleWhileRevalidate(request),
  )
})
