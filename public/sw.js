importScripts('/sw-policy.js')

const CACHE = 'vyntechs-public-shell-v4'
const POLICY_MARKER = 'vyntechs-public-policy-v1'
const PUBLIC_SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']
const POLICY_PROBE = 'VYNTECHS_CACHE_POLICY_PROBE'
const POLICY_PROOF = 'VYNTECHS_CACHE_POLICY_PROOF'
const POLICY_SCRIPT = '/sw.js?cache-policy=public-v4'
const PROBE_TIMEOUT_MS = 500

function requestImmediateActivation() {
  return self.skipWaiting()
}

function workerMatchesCurrentPolicy(activeWorker) {
  try {
    return (
      new URL(activeWorker.scriptURL).href ===
      new URL(POLICY_SCRIPT, self.location.origin).href
    )
  } catch {
    return false
  }
}

async function hasDurablePublicOnlyProof(activeWorker) {
  if (!workerMatchesCurrentPolicy(activeWorker)) return false

  try {
    if (!(await caches.has(POLICY_MARKER))) return false
    const marker = await caches.open(POLICY_MARKER)
    if ((await marker.keys()).length !== 0) return false

    const allowed = new Set([CACHE, POLICY_MARKER])
    return (await caches.keys()).every((key) => allowed.has(key))
  } catch {
    return false
  }
}

function activeWorkerProvesPublicOnly(activeWorker) {
  return new Promise((resolve) => {
    let channel
    let timeout
    let settled = false

    const finish = (proved) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        channel?.port1.close()
      } catch {
        proved = false
      }
      resolve(proved)
    }

    try {
      channel = new MessageChannel()
      timeout = setTimeout(() => finish(false), PROBE_TIMEOUT_MS)
      channel.port1.onmessage = (event) => {
        finish(self.VyntechsSwPolicy.isPublicOnlyProof(event.data))
      }
      channel.port1.onmessageerror = () => finish(false)
      channel.port1.start()
      activeWorker.postMessage({ type: POLICY_PROBE }, [channel.port2])
    } catch {
      finish(false)
    }
  })
}

async function seedPublicShell() {
  const cache = await caches.open(CACHE)
  await cache.addAll(PUBLIC_SHELL)
}

async function installSafely() {
  const activeWorker = self.registration.active

  if (!activeWorker) {
    await seedPublicShell()
    return
  }

  if (await hasDurablePublicOnlyProof(activeWorker)) {
    await seedPublicShell()
    return
  }

  if (await activeWorkerProvesPublicOnly(activeWorker)) {
    await seedPublicShell()
    return
  }

  await requestImmediateActivation()
}

self.addEventListener('install', (event) => {
  event.waitUntil(installSafely())
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ACTIVATE') {
    void requestImmediateActivation()
    return
  }

  if (event.data && event.data.type === POLICY_PROBE && event.ports[0]) {
    event.ports[0].postMessage({
      type: POLICY_PROOF,
      capability: self.VyntechsSwPolicy.cachePolicyCapability,
    })
  }
})

async function scrubObsoleteCaches() {
  try {
    const allowed = new Set([CACHE, POLICY_MARKER])
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((key) => !allowed.has(key)).map((key) => caches.delete(key)),
    )
    return true
  } catch {
    return false
  }
}

async function removeActivationMarker() {
  try {
    await caches.delete(POLICY_MARKER)
  } catch {
    // Validation rejects a surviving non-empty or inaccessible marker.
  }
}

async function recreateEmptyActivationMarker() {
  try {
    await removeActivationMarker()
    const marker = await caches.open(POLICY_MARKER)
    if ((await marker.keys()).length === 0) return true
  } catch {
    // The fetch path validates the marker and remains network-only without it.
  }

  await removeActivationMarker()
  return false
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const scrubbedBeforeClaim = await scrubObsoleteCaches()
      await self.clients.claim()
      const scrubbedAfterClaim = await scrubObsoleteCaches()

      if (scrubbedBeforeClaim && scrubbedAfterClaim) {
        await recreateEmptyActivationMarker()
      } else {
        await removeActivationMarker()
      }
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const policy = self.VyntechsSwPolicy.classifyRequest(event.request, self.location.origin)

  if (policy === 'navigate-network') {
    event.respondWith(fetchNavigation(event.request))
    return
  }

  if (policy === 'public-cache') {
    event.respondWith(fetchPublicAsset(event.request))
  }
})

async function fetchPublicAsset(request) {
  if (!(await hasDurablePublicOnlyProof(self.registration.active))) {
    return fetch(request)
  }

  let cache

  try {
    cache = await caches.open(CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
  } catch {
    // Cache Storage is optional; the public network response remains authoritative.
  }

  const response = await fetch(request)

  if (response.ok && cache) {
    try {
      await cache.put(request, response.clone())
    } catch {
      // A cache write failure must not hide a successful public response.
    }
  }

  return response
}

async function fetchNavigation(request) {
  try {
    return await fetch(request)
  } catch (networkError) {
    if (!(await hasDurablePublicOnlyProof(self.registration.active))) {
      throw networkError
    }

    try {
      const offline = await caches.match('/offline.html', { cacheName: CACHE })
      if (offline) return offline
    } catch {
      // Cache Storage is optional; preserve the original network failure.
    }

    throw networkError
  }
}
