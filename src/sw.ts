/**
 * Aphelion's service worker — what makes "open it on a plane" literally true.
 *
 * The app already issues no third-party requests: every script, texture and
 * ephemeris table is served from this origin. What was missing was surviving a
 * *reload* with no network, which needs the responses in a cache the worker can
 * serve from while offline.
 *
 * vite-plugin-pwa replaces `self.__WB_MANIFEST` at build time with every file
 * in `dist/` and a content hash for each, and the build fails if that
 * placeholder is missing. The manifest is split in two here:
 *
 * - The shell (index.html, the hashed chunks, the star catalogue, the icon and
 *   web manifest) is precached on install. Workbox keeps exactly one copy of
 *   each and drops whatever a deploy no longer lists.
 * - The imagery (textures/ and shapes/, 130 MB) is cached only once a flight
 *   has actually needed it, but under its revision, so a cached map is served
 *   without touching the network until a deploy changes that file. The VR
 *   interface (assets/vr/, see vite.config.ts) is treated the same way: a
 *   visitor without a headset never downloads it, and a session that has been
 *   started once also starts offline.
 *
 * Navigations go to the network so a new deploy is picked up whenever the
 * reader is online, and fall back to the precached index.html. Anything else
 * is left to the browser.
 */

import type { WorkboxPlugin } from 'workbox-core';
import type { PrecacheEntry } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

const MEDIA_CACHE = 'aphelion-media';
const MEDIA_PREFIXES = ['textures/', 'shapes/', 'assets/vr/'].map(
  (dir) => new URL(dir, self.location.href).href,
);

/** The query parameter Workbox's own precache uses to key a revision. */
const REVISION_PARAM = '__WB_REVISION__';

/** Every build-time manifest entry resolved to an absolute URL. */
function resolveEntry(entry: PrecacheEntry | string): { url: string; revision: string } {
  const { url, revision } = typeof entry === 'string' ? { url: entry, revision: null } : entry;
  return { url: new URL(url, self.location.href).href, revision: revision ?? '' };
}

const shell: Array<PrecacheEntry | string> = [];
/** Absolute imagery URL → the revision this deploy ships. */
const media = new Map<string, string>();
for (const entry of self.__WB_MANIFEST) {
  const { url, revision } = resolveEntry(entry);
  if (MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    media.set(url, revision);
  } else {
    shell.push(entry);
  }
}

/** The cache key for an imagery URL: the URL plus the revision this deploy ships. */
function revisionedKey(url: string): string {
  const key = new URL(url);
  key.searchParams.set(REVISION_PARAM, media.get(key.href) ?? '');
  return key.href;
}

const revisioned: WorkboxPlugin = {
  // oxlint-disable-next-line typescript/require-await -- Workbox types every plugin hook as async
  cacheKeyWillBeUsed: async ({ request }) => revisionedKey(request.url),
  // The previous revision is kept until its replacement is stored, so a reader
  // who goes offline right after a deploy still has last deploy's map.
  cacheDidUpdate: async ({ cacheName, request }) => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys(request, { ignoreSearch: true });
    await Promise.all(
      keys.filter((key) => key.url !== request.url).map(async (key) => cache.delete(key)),
    );
  },
  handlerDidError: async ({ request }) => {
    const cache = await caches.open(MEDIA_CACHE);
    return cache.match(request, { ignoreSearch: true });
  },
};

/**
 * Drop the imagery a deploy no longer ships, and the caches of the hand-written
 * worker this one replaced: its shell cache per deploy and its runtime cache,
 * which also held every hashed chunk ever served and was never swept.
 */
async function sweep(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name === 'aphelion-runtime' || name.startsWith('aphelion-shell-'))
      .map(async (name) => caches.delete(name)),
  );

  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((key) => {
        const url = new URL(key.url);
        url.search = '';
        return !media.has(url.href);
      })
      .map(async (key) => cache.delete(key)),
  );
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(sweep());
});
clientsClaim();
cleanupOutdatedCaches();

// Registered before the precache route, which would otherwise answer a bare
// navigation to the site root with the cached index.html.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkOnly({
    plugins: [
      { handlerDidError: async (): Promise<Response | undefined> => matchPrecache('index.html') },
    ],
  }),
);
precacheAndRoute(shell);
registerRoute(
  ({ url }) => media.has(url.href),
  new CacheFirst({ cacheName: MEDIA_CACHE, plugins: [revisioned] }),
);
