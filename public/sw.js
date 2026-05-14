// Vyntechs PWA service worker
// App-shell cache + network-passthrough for API and Next.js dynamic chunks.

const CACHE = 'vyntechs-shell-v2'
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

  // Cache-first for the static shell.
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  )
})
