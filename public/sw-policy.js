;(function installVyntechsSwPolicy(root) {
  const publicPrefixes = ['/icons/', '/brand/']
  const cachePolicyCapability = 'public-only-v1'

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

  function isPublicOnlyProof(value) {
    try {
      const keys = Reflect.ownKeys(value)
      return Boolean(
        value &&
          typeof value === 'object' &&
          keys.length === 2 &&
          Object.prototype.hasOwnProperty.call(value, 'type') &&
          Object.prototype.hasOwnProperty.call(value, 'capability') &&
          value.type === 'VYNTECHS_CACHE_POLICY_PROOF' &&
          value.capability === cachePolicyCapability,
      )
    } catch {
      return false
    }
  }

  root.VyntechsSwPolicy = Object.freeze({
    cachePolicyCapability,
    classifyRequest,
    isPublicOnlyProof,
  })
})(typeof self === 'object' ? self : globalThis)
