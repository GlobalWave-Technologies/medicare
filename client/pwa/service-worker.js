/* Medicare service worker.
 *
 * It caches only the static application files of one release (the page shell, fingerprinted
 * JavaScript and CSS, icons, manifest, favicon and theme script). It never caches, stores or
 * replays API traffic: patients, appointments, clinical records, notifications, staff, dashboard
 * and report data always come from the network. There is no background sync, no push
 * subscription and no periodic sync. The build writes the release version and file list below.
 */
const VERSION = '__MEDICARE_SW_VERSION__'
const PRECACHE = __MEDICARE_SW_FILES__
const PREFIX = 'medicare-static-'
const CACHE = PREFIX + VERSION
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  // Fresh copies from the server (bypassing the HTTP cache) so a release is cached whole.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove only Medicare's own earlier release caches; never any other cache on the origin.
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
    }
    await self.clients.claim()
  })())
})

// A waiting release activates only when a person chooses "Refresh when safe".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Hospital data and authentication: always the network, never stored here.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    // The live page when online. Offline, the cached shell loads; it holds no data and shows the
    // connection-required screen because every record request still needs the server.
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(SHELL)).then((shell) => shell || Response.error())))
    return
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((hit) => hit || fetch(request)))
  }
})
