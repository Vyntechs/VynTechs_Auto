importScripts('/sw-policy.js')

const CACHE = 'vyntechs-public-shell-v4'
const POLICY_MARKER = 'vyntechs-public-policy-v1'
const PUBLIC_SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']
const POLICY_PROBE = 'VYNTECHS_CACHE_POLICY_PROBE'
const POLICY_PROOF = 'VYNTECHS_CACHE_POLICY_PROOF'
const POLICY_SCRIPT = '/sw.js?cache-policy=public-v4'
const POLICY_RECEIPT_REQUEST = '/icons/icon-192.png?cache-policy=public-v4'
const POLICY_RECEIPT_HEADER = 'x-vyntechs-cache-policy'
const POLICY_REVOKED_CAPABILITY = 'revoked-v1'
const PROBE_TIMEOUT_MS = 500
const OPERATION_TIMEOUT_MS = 500
let durableProofRevoked =
  !self.serviceWorker || self.serviceWorker.state !== 'installing'
let runtimeRecoveryPromise

function requestImmediateActivation() {
  return self.skipWaiting()
}

function settleOperation(operation) {
  return new Promise((resolve) => {
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(
      () => finish({ ok: false }),
      OPERATION_TIMEOUT_MS,
    )

    try {
      Promise.resolve(operation()).then(
        (value) => finish({ ok: true, value }),
        () => finish({ ok: false }),
      )
    } catch {
      finish({ ok: false })
    }
  })
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
  if (
    durableProofRevoked &&
    !(await startRuntimePublicOnlyRecovery(activeWorker))
  ) {
    return false
  }
  if (!workerMatchesCurrentPolicy(activeWorker)) {
    durableProofRevoked = true
    return false
  }

  const firstCatalog = await settleOperation(() => caches.keys())
  if (!firstCatalog.ok || !catalogProvesPublicOnly(firstCatalog.value)) {
    durableProofRevoked = true
    return false
  }

  const receipt = await settleOperation(() =>
    caches.match(POLICY_RECEIPT_REQUEST, { cacheName: POLICY_MARKER }),
  )
  if (!receipt.ok || !receiptProvesPublicOnly(receipt.value)) {
    durableProofRevoked = true
    return false
  }

  const markerResult = await settleOperation(() => caches.open(POLICY_MARKER))
  if (!markerResult.ok) {
    durableProofRevoked = true
    return false
  }

  const markerKeys = await settleOperation(() => markerResult.value.keys())
  if (
    !markerKeys.ok ||
    !Array.isArray(markerKeys.value) ||
    markerKeys.value.length !== 1 ||
    requestHref(markerKeys.value[0]) !==
      new URL(POLICY_RECEIPT_REQUEST, self.location.origin).href
  ) {
    durableProofRevoked = true
    await deleteCacheAndVerify(POLICY_MARKER)
    return false
  }

  const finalCatalog = await settleOperation(() => caches.keys())
  const valid = Boolean(
    finalCatalog.ok && catalogProvesPublicOnly(finalCatalog.value),
  )
  if (!valid) durableProofRevoked = true
  return valid
}

function catalogProvesPublicOnly(keys) {
  const allowed = new Set([CACHE, POLICY_MARKER])
  return (
    Array.isArray(keys) &&
    keys.includes(POLICY_MARKER) &&
    keys.every((key) => allowed.has(key))
  )
}

function receiptProvesPublicOnly(response) {
  try {
    return (
      response &&
      response.headers.get(POLICY_RECEIPT_HEADER) ===
        self.VyntechsSwPolicy.cachePolicyCapability
    )
  } catch {
    return false
  }
}

function requestHref(request) {
  try {
    return new URL(
      typeof request === 'string' ? request : request.url,
      self.location.origin,
    ).href
  } catch {
    return ''
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
  const cache = await settleOperation(() => caches.open(CACHE))
  if (!cache.ok) throw new Error('Public shell cache unavailable')

  const seeded = await settleOperation(() => cache.value.addAll(PUBLIC_SHELL))
  if (!seeded.ok) throw new Error('Public shell seed unavailable')
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

  if (
    event.data &&
    event.data.type === POLICY_PROBE &&
    event.ports[0] &&
    !durableProofRevoked
  ) {
    event.ports[0].postMessage({
      type: POLICY_PROOF,
      capability: self.VyntechsSwPolicy.cachePolicyCapability,
    })
  }
})

async function scrubObsoleteCaches() {
  const catalog = await settleOperation(() => caches.keys())
  if (!catalog.ok || !Array.isArray(catalog.value)) return false

  const allowed = new Set([CACHE, POLICY_MARKER])
  const results = await Promise.all(
    catalog.value
      .filter((key) => !allowed.has(key))
      .map((key) => deleteCacheAndVerify(key)),
  )
  return results.every(Boolean)
}

async function deleteCacheAndVerify(name) {
  await settleOperation(() => caches.delete(name))
  const remaining = await settleOperation(() => caches.has(name))
  return Boolean(remaining.ok && !remaining.value)
}

async function removeActivationMarker() {
  durableProofRevoked = true
  return deleteCacheAndVerify(POLICY_MARKER)
}

async function revokeActivationReceipt() {
  durableProofRevoked = true
  const markerResult = await settleOperation(() => caches.open(POLICY_MARKER))
  if (!markerResult.ok) return false

  const revoked = new Response('', {
    headers: { [POLICY_RECEIPT_HEADER]: POLICY_REVOKED_CAPABILITY },
  })
  const stored = await settleOperation(() =>
    markerResult.value.put(POLICY_RECEIPT_REQUEST, revoked),
  )
  if (!stored.ok) return false

  const observed = await settleOperation(() =>
    caches.match(POLICY_RECEIPT_REQUEST, { cacheName: POLICY_MARKER }),
  )
  try {
    return Boolean(
      observed.ok &&
        observed.value?.headers.get(POLICY_RECEIPT_HEADER) ===
          POLICY_REVOKED_CAPABILITY,
    )
  } catch {
    return false
  }
}

async function recreateActivationReceipt() {
  if (!(await removeActivationMarker())) return false

  const markerResult = await settleOperation(() => caches.open(POLICY_MARKER))
  if (!markerResult.ok) {
    await removeActivationMarker()
    return false
  }

  const receipt = new Response('', {
    headers: {
      [POLICY_RECEIPT_HEADER]:
        self.VyntechsSwPolicy.cachePolicyCapability,
    },
  })
  const stored = await settleOperation(() =>
    markerResult.value.put(POLICY_RECEIPT_REQUEST, receipt),
  )
  if (!stored.ok) {
    await removeActivationMarker()
    return false
  }

  const markerKeys = await settleOperation(() => markerResult.value.keys())
  const catalog = await settleOperation(() => caches.keys())
  const valid =
    markerKeys.ok &&
    Array.isArray(markerKeys.value) &&
    markerKeys.value.length === 1 &&
    requestHref(markerKeys.value[0]) ===
      new URL(POLICY_RECEIPT_REQUEST, self.location.origin).href &&
    catalog.ok &&
    catalogProvesPublicOnly(catalog.value)

  if (!valid) {
    await removeActivationMarker()
    return false
  }

  durableProofRevoked = false
  return true
}

async function recoverRuntimePublicOnlyState(activeWorker) {
  if (!workerMatchesCurrentPolicy(activeWorker)) return false

  const receiptRevoked = await revokeActivationReceipt()
  const scrubbed = await scrubObsoleteCaches()

  if (!receiptRevoked || !scrubbed) {
    await removeActivationMarker()
    return false
  }

  return recreateActivationReceipt()
}

function startRuntimePublicOnlyRecovery(activeWorker) {
  if (!durableProofRevoked) return Promise.resolve(true)
  if (runtimeRecoveryPromise) return runtimeRecoveryPromise

  let attempt
  attempt = recoverRuntimePublicOnlyState(activeWorker)
    .catch(() => false)
    .finally(() => {
      if (runtimeRecoveryPromise === attempt) {
        runtimeRecoveryPromise = undefined
      }
    })
  runtimeRecoveryPromise = attempt
  return attempt
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      durableProofRevoked = true
      const receiptRevoked = await revokeActivationReceipt()
      const scrubbedBeforeClaim = await scrubObsoleteCaches()
      const claimed = await settleOperation(() => self.clients.claim())
      const scrubbedAfterClaim = await scrubObsoleteCaches()

      if (
        receiptRevoked &&
        scrubbedBeforeClaim &&
        scrubbedAfterClaim &&
        claimed.ok
      ) {
        await recreateActivationReceipt()
      } else {
        await removeActivationMarker()
      }
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const policy = self.VyntechsSwPolicy.classifyRequest(event.request, self.location.origin)
  const recoveryRequired = durableProofRevoked

  if (
    (policy === 'navigate-network' || policy === 'public-cache') &&
    recoveryRequired
  ) {
    event.waitUntil(startRuntimePublicOnlyRecovery(self.registration.active))
  }

  if (policy === 'navigate-network') {
    event.respondWith(fetchNavigation(event.request))
    return
  }

  if (policy === 'public-cache') {
    event.respondWith(fetchPublicAsset(event.request, recoveryRequired))
  }
})

async function fetchPublicAsset(request, recoveryRequired) {
  if (recoveryRequired) return fetch(request)
  if (!(await hasDurablePublicOnlyProof(self.registration.active))) {
    return fetch(request)
  }

  let cache

  const cacheResult = await settleOperation(() => caches.open(CACHE))
  if (cacheResult.ok) {
    cache = cacheResult.value
    const cached = await settleOperation(() => cache.match(request))
    if (cached.ok && cached.value) return cached.value
  }

  const response = await fetch(request)

  if (response.ok && cache) {
    const copy = response.clone()
    void storePublicResponse(cache, request, copy)
  }

  return response
}

async function storePublicResponse(cache, request, response) {
  if (!(await hasDurablePublicOnlyProof(self.registration.active))) return
  await settleOperation(() => cache.put(request, response))
}

async function fetchNavigation(request) {
  try {
    return await fetch(request)
  } catch (networkError) {
    if (!(await hasDurablePublicOnlyProof(self.registration.active))) {
      throw networkError
    }

    const offline = await settleOperation(() =>
      caches.match('/offline.html', { cacheName: CACHE }),
    )
    if (offline.ok && offline.value) return offline.value

    throw networkError
  }
}
