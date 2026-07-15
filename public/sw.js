importScripts('/sw-policy.js')

const CACHE = 'vyntechs-public-shell-v4'
const PUBLIC_SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_SHELL)))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ACTIVATE') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const policy = self.VyntechsSwPolicy.classifyRequest(event.request, self.location.origin)

  if (policy === 'navigate-network') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
    return
  }

  if (policy === 'public-cache') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok) await cache.put(event.request, response.clone())
        return response
      }),
    )
  }
})
