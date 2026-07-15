;(function installVyntechsSwPolicy(root) {
  const publicPrefixes = ['/icons/', '/brand/']

  function classifyRequest(request, origin) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== origin) return 'network'
    if (request.mode === 'navigate' || request.destination === 'document') {
      return 'navigate-network'
    }
    return publicPrefixes.some((prefix) => url.pathname.startsWith(prefix))
      ? 'public-cache'
      : 'network'
  }

  root.VyntechsSwPolicy = Object.freeze({ classifyRequest })
})(typeof self === 'object' ? self : globalThis)
