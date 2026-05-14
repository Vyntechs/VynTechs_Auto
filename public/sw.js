// Vyntechs PWA service worker
// Strategy:
//   - HTML / page navigations: network-first (so new deployments are seen
//     automatically on the next refresh). Falls back to cache if offline.
//   - Static assets: cache-first (Next.js fingerprints filenames, so the
//     cache identifier is implicitly per-version).
//   - API + /_next: pass through to network, never intercepted.

const CACHE = 'vyntechs-shell-v3'
const SHELL = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept API or Next.js build assets — let the network handle them.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) {
    return
  }

  // Network-first for HTML navigation requests so new deploys land immediately.
  // Fall back to cache for offline use.
  const isNavigate =
    event.request.mode === 'navigate' || event.request.destination === 'document'

  if (isNavigate) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached ?? caches.match('/')),
        ),
    )
    return
  }

  // Cache-first for static assets (images, fonts, anything else).
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  )
})
