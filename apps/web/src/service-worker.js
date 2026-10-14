const CACHE_NAME = '__ARKGRID_CACHE_NAME__'
const PRECACHE_URLS = __ARKGRID_PRECACHE_URLS__
const INDEX_URL = new URL('./index.html', self.registration.scope).href
const PRECACHED_PATHS = new Set(
  PRECACHE_URLS.map(path => new URL(path, self.registration.scope).pathname),
)

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => name.startsWith('arkgrid-shell-') && name !== CACHE_NAME)
          .map(name => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.includes('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match(INDEX_URL))
        .then(response => response || fetch(request))
        .catch(() => new Response('ArkGrid is offline. Reopen the cached app shell to use Emergency Mode.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })),
    )
    return
  }

  if (!PRECACHED_PATHS.has(url.pathname)) return
  event.respondWith(
    caches.open(CACHE_NAME)
      .then(async cache => {
        const cached = await cache.match(new URL(url.pathname, self.registration.scope).href)
        if (cached) return cached
        const response = await fetch(request)
        return response
      }),
  )
})
