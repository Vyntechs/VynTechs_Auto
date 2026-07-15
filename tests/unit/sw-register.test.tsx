import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { SwRegister } from '@/components/sw-register'
import {
  PWA_UPDATE_READY_EVENT,
  type PwaUpdateReadyDetail,
} from '@/components/app-shell/pwa-update-events'

type MutableServiceWorker = ServiceWorker & { state: ServiceWorkerState }

let register: ReturnType<typeof vi.fn>
let serviceWorkerContainer: ServiceWorkerContainer
let updateReadyListener: EventListener | undefined

function createServiceWorker(state: ServiceWorkerState = 'installing'): MutableServiceWorker {
  const worker = new EventTarget() as MutableServiceWorker

  Object.defineProperties(worker, {
    state: { configurable: true, writable: true, value: state },
    postMessage: { configurable: true, value: vi.fn() },
  })

  return worker
}

function createRegistration({
  waiting = null,
  installing = null,
  update = vi.fn().mockResolvedValue(undefined),
}: {
  waiting?: ServiceWorker | null
  installing?: ServiceWorker | null
  update?: ReturnType<typeof vi.fn>
} = {}): ServiceWorkerRegistration {
  const registration = new EventTarget() as ServiceWorkerRegistration

  Object.defineProperties(registration, {
    waiting: { configurable: true, value: waiting },
    installing: { configurable: true, value: installing },
    update: { configurable: true, value: update },
  })

  return registration
}

function setController(controller: ServiceWorker | null) {
  Object.defineProperty(serviceWorkerContainer, 'controller', {
    configurable: true,
    value: controller,
  })
}

function listenForUpdateReady(listener: (event: CustomEvent<PwaUpdateReadyDetail>) => void) {
  updateReadyListener = listener as EventListener
  window.addEventListener(PWA_UPDATE_READY_EVENT, updateReadyListener)
}

type WorkerProof = 'valid' | 'invalid' | 'silent' | 'throw'
type ChannelFailure = 'construct' | 'start' | 'close'
const POLICY_MARKER = 'vyntechs-public-policy-v1'
const POLICY_RECEIPT_REQUEST =
  '/icons/icon-192.png?cache-policy=public-v4'

class HarnessPort {
  peer: HarnessPort | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(data: unknown) {
    queueMicrotask(() => this.peer?.onmessage?.({ data }))
  }

  close() {}

  start() {}
}

class HarnessMessageChannel {
  port1 = new HarnessPort()
  port2 = new HarnessPort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function cacheRequestKey(request: unknown): string {
  if (typeof request === 'string') return request
  if (request instanceof URL) return request.href
  if (request && typeof request === 'object' && 'url' in request) {
    return String(request.url)
  }
  return String(request)
}

function createWorkerHarness({
  active = true,
  activeScriptURL = 'https://app.vyntechs.test/sw.js',
  channelFailure,
  proof = 'silent',
  cacheNames = [],
}: {
  active?: boolean
  activeScriptURL?: string
  channelFailure?: ChannelFailure
  proof?: WorkerProof
  cacheNames?: string[]
} = {}) {
  let listeners = new Map<string, Array<(event: any) => void>>()
  const operations: string[] = []
  const cachesByName = new Map<string, ReturnType<typeof makeCache>>()
  const failDeleteNames = new Set<string>()
  const failOpenNames = new Set<string>()
  const failCacheKeysNames = new Set<string>()
  const failPutNames = new Set<string>()
  const hangDeleteNames = new Set<string>()
  const hangCacheKeysNames = new Set<string>()
  const hangOpenNames = new Set<string>()
  const hangPutNames = new Set<string>()
  let failNextOpen = false
  let failNextFetch = false
  let failKeysCalls = new Set<number>()
  let hangKeysCalls = new Set<number>()
  let keysCallCount = 0
  let evictMarkerBeforeOpen = false

  function makeCache(name: string) {
    const entries = new Map<string, Response>()
    let hangNextAddAll = false
    let failNextMatch = false
    let failNextPut = false
    let hangNextMatch = false
    let hangNextPut = false
    const cache = {
      addAll: vi.fn(async (requests: string[]) => {
        operations.push(`seed:${name}`)
        if (hangNextAddAll) {
          hangNextAddAll = false
          return new Promise<void>(() => undefined)
        }
        for (const request of requests) {
          entries.set(request, new Response(`public:${request}`, { status: 200 }))
        }
      }),
      match: vi.fn(async (request: unknown) => {
        operations.push(`match:${name}`)
        if (hangNextMatch) {
          hangNextMatch = false
          return new Promise<Response | undefined>(() => undefined)
        }
        if (failNextMatch) {
          failNextMatch = false
          throw new Error('cache match unavailable')
        }
        return entries.get(cacheRequestKey(request))
      }),
      put: vi.fn(async (request: unknown, response: Response) => {
        operations.push(`put:${name}`)
        if (hangPutNames.has(name)) {
          return new Promise<void>(() => undefined)
        }
        if (failPutNames.has(name)) {
          throw new Error(`cache put unavailable: ${name}`)
        }
        if (hangNextPut) {
          hangNextPut = false
          return new Promise<void>(() => undefined)
        }
        if (failNextPut) {
          failNextPut = false
          throw new Error('cache put unavailable')
        }
        entries.set(cacheRequestKey(request), response)
      }),
      keys: vi.fn(async () => {
        if (hangCacheKeysNames.has(name)) {
          hangCacheKeysNames.delete(name)
          return new Promise<string[]>(() => undefined)
        }
        if (failCacheKeysNames.has(name)) {
          failCacheKeysNames.delete(name)
          throw new Error(`cache keys unavailable: ${name}`)
        }
        return [...entries.keys()]
      }),
      failMatchOnce() {
        failNextMatch = true
      },
      failPutOnce() {
        failNextPut = true
      },
      hangMatchOnce() {
        hangNextMatch = true
      },
      hangAddAllOnce() {
        hangNextAddAll = true
      },
      hangPutOnce() {
        hangNextPut = true
      },
      entryCount() {
        return entries.size
      },
    }
    return cache
  }

  for (const name of cacheNames) cachesByName.set(name, makeCache(name))

  const cacheStorage = {
    open: vi.fn(async (name: string) => {
      operations.push(`open:${name}`)
      if (name === POLICY_MARKER && evictMarkerBeforeOpen) {
        evictMarkerBeforeOpen = false
        cachesByName.delete(name)
        operations.push('marker-evicted-before-open')
      }
      if (hangOpenNames.has(name)) {
        return new Promise<ReturnType<typeof makeCache>>(() => undefined)
      }
      if (failOpenNames.has(name)) {
        failOpenNames.delete(name)
        throw new Error(`cache open unavailable: ${name}`)
      }
      if (failNextOpen) {
        failNextOpen = false
        throw new Error('cache storage unavailable')
      }
      let cache = cachesByName.get(name)
      if (!cache) {
        cache = makeCache(name)
        cachesByName.set(name, cache)
      }
      return cache
    }),
    has: vi.fn(async (name: string) => cachesByName.has(name)),
    keys: vi.fn(async () => {
      operations.push('keys')
      keysCallCount += 1
      if (hangKeysCalls.has(keysCallCount)) {
        return new Promise<string[]>(() => undefined)
      }
      if (failKeysCalls.has(keysCallCount)) {
        throw new Error('cache catalog unavailable')
      }
      return [...cachesByName.keys()]
    }),
    delete: vi.fn(async (name: string) => {
      operations.push(`delete:${name}`)
      if (hangDeleteNames.has(name)) {
        return new Promise<boolean>(() => undefined)
      }
      if (failDeleteNames.has(name)) {
        throw new Error(`cache deletion unavailable: ${name}`)
      }
      return cachesByName.delete(name)
    }),
    match: vi.fn(async (request: unknown, options?: { cacheName?: string }) => {
      const namedCache = options?.cacheName
        ? cachesByName.get(options.cacheName)
        : undefined
      const candidates: Array<ReturnType<typeof makeCache>> = options?.cacheName
        ? namedCache
          ? [namedCache]
          : []
        : [...cachesByName.values()]
      for (const cache of candidates) {
        const response = await cache.match(request)
        if (response) return response
      }
      return undefined
    }),
  }

  const activeWorker = active
    ? {
        scriptURL: activeScriptURL,
        postMessage: vi.fn((message: unknown, transfer?: unknown) => {
          operations.push('probe-active')
          if (proof === 'throw') throw new Error('legacy postMessage failed')
          if (proof === 'silent') return
          const ports = Array.isArray(transfer)
            ? transfer
            : transfer && typeof transfer === 'object' && 'transfer' in transfer
              ? (transfer.transfer as HarnessPort[])
              : []
          ports[0]?.postMessage(
            proof === 'valid'
              ? {
                  type: 'VYNTECHS_CACHE_POLICY_PROOF',
                  capability: 'public-only-v1',
                }
              : {
                  type: 'VYNTECHS_CACHE_POLICY_PROOF',
                  capability: 'private-cache-v3',
                },
          )
        }),
      }
    : null

  const WorkerMessageChannel =
    channelFailure === 'construct'
      ? class {
          constructor() {
            throw new Error('message channel unavailable')
          }
        }
      : class extends HarnessMessageChannel {
          constructor() {
            super()
            if (channelFailure === 'start') {
              this.port1.start = () => {
                throw new Error('message port could not start')
              }
            }
            if (channelFailure === 'close') {
              this.port1.close = () => {
                throw new Error('message port could not close')
              }
            }
          }
        }

  const skipWaiting = vi.fn(async () => {
    operations.push('skipWaiting')
  })
  let claimFailure: 'throw' | 'hang' | undefined
  const claim = vi.fn(async () => {
    operations.push('claim')
    const failure = claimFailure
    claimFailure = undefined
    if (failure === 'throw') throw new Error('client claim unavailable')
    if (failure === 'hang') return new Promise<void>(() => undefined)
  })
  const fetchResponse = new Response('network-public', { status: 200 })
  const fetchWorker = vi.fn(async () => {
    if (failNextFetch) {
      failNextFetch = false
      throw new Error('network unavailable')
    }
    return fetchResponse.clone()
  })
  function bootWorker(state: 'installing' | 'activated' = 'installing') {
    listeners = new Map()
    const workerSelf = {
      registration: { active: activeWorker },
      serviceWorker: { state },
      location: { origin: 'https://app.vyntechs.test' },
      clients: { claim },
      skipWaiting,
      addEventListener(type: string, listener: (event: any) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
    } as Record<string, unknown>
    const context = {
      self: workerSelf,
      caches: cacheStorage,
      fetch: fetchWorker,
      importScripts: vi.fn(),
      URL,
      Response,
      Request,
      Headers,
      MessageChannel: WorkerMessageChannel,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      console,
    }

    runInNewContext(
      readFileSync(resolve(__dirname, '../../public/sw-policy.js'), 'utf-8'),
      context,
    )
    runInNewContext(
      readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf-8'),
      context,
    )
  }

  bootWorker()

  async function dispatchExtendable(type: 'install' | 'activate') {
    let lifetime: Promise<unknown> | undefined
    for (const listener of listeners.get(type) ?? []) {
      listener({
        waitUntil(value: Promise<unknown>) {
          lifetime = Promise.resolve(value)
        },
      })
    }
    if (!lifetime) throw new Error(`${type} did not extend its lifetime`)
    await lifetime
  }

  function dispatchFetchWithLifetime(request: {
    url: string
    method: string
    mode?: string
    destination?: string
  }) {
    let response: Promise<Response | undefined> | undefined
    const lifetimes: Promise<unknown>[] = []
    for (const listener of listeners.get('fetch') ?? []) {
      listener({
        request,
        waitUntil(value: Promise<unknown>) {
          lifetimes.push(Promise.resolve(value))
        },
        respondWith(value: Promise<Response | undefined>) {
          response = Promise.resolve(value)
        },
      })
    }
    if (!response) throw new Error('fetch was not intercepted')
    return { response, lifetime: Promise.all(lifetimes) }
  }

  async function dispatchFetch(request: {
    url: string
    method: string
    mode?: string
    destination?: string
  }) {
    return dispatchFetchWithLifetime(request).response
  }

  function dispatchMessage(data: unknown, ports: HarnessPort[] = []) {
    for (const listener of listeners.get('message') ?? []) {
      listener({ data, ports })
    }
  }

  return {
    activeWorker,
    cacheStorage,
    claim,
    dispatchActivate: () => dispatchExtendable('activate'),
    dispatchFetch,
    dispatchFetchWithLifetime,
    dispatchInstall: () => dispatchExtendable('install'),
    dispatchMessage,
    failOpenOnce() {
      failNextOpen = true
    },
    failDeleteFor(name: string) {
      failDeleteNames.add(name)
    },
    failCacheKeysFor(name: string) {
      failCacheKeysNames.add(name)
    },
    failClaimOnce() {
      claimFailure = 'throw'
    },
    failOpenFor(name: string) {
      failOpenNames.add(name)
    },
    failPutFor(name: string) {
      failPutNames.add(name)
    },
    failKeysOn(...calls: number[]) {
      failKeysCalls = new Set(calls)
    },
    hangDeleteFor(name: string) {
      hangDeleteNames.add(name)
    },
    hangCacheKeysFor(name: string) {
      hangCacheKeysNames.add(name)
    },
    hangClaimOnce() {
      claimFailure = 'hang'
    },
    hangKeysOn(...calls: number[]) {
      hangKeysCalls = new Set(calls)
    },
    hangOpenFor(name: string) {
      hangOpenNames.add(name)
    },
    hangPutFor(name: string) {
      hangPutNames.add(name)
    },
    evictMarkerBeforeNextOpen() {
      evictMarkerBeforeOpen = true
    },
    failNetworkOnce() {
      failNextFetch = true
    },
    fetchWorker,
    getCache(name: string) {
      return cachesByName.get(name)
    },
    operations,
    rebootWorker: () => bootWorker('activated'),
    skipWaiting,
    cacheNames: () => [...cachesByName.keys()],
  }
}

async function installPolicyReceipt(
  harness: ReturnType<typeof createWorkerHarness>,
) {
  const marker = harness.getCache(POLICY_MARKER)
  if (!marker) throw new Error('policy marker cache is missing')

  await marker.put(
    POLICY_RECEIPT_REQUEST,
    new Response('', {
      headers: { 'x-vyntechs-cache-policy': 'public-only-v1' },
    }),
  )
}

beforeEach(() => {
  register = vi.fn().mockResolvedValue(createRegistration())
  serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer
  Object.defineProperties(serviceWorkerContainer, {
    controller: { configurable: true, value: null },
    register: { configurable: true, value: register },
  })

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorkerContainer,
  })
})

afterEach(() => {
  if (updateReadyListener) {
    window.removeEventListener(PWA_UPDATE_READY_EVENT, updateReadyListener)
    updateReadyListener = undefined
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('SwRegister', () => {
  it('does not register the service worker outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<SwRegister />)
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
  })

  it('forces one fresh, root-scoped privacy migration check in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const update = vi.fn().mockResolvedValue(undefined)
    register.mockResolvedValue(createRegistration({ update }))

    render(<SwRegister />)

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/sw.js?cache-policy=public-v4', {
        scope: '/',
        updateViaCache: 'none',
      })
      expect(update).toHaveBeenCalledOnce()
    })
  })

  it('keeps the registered lifecycle observable when the fresh update check fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const waiting = createServiceWorker('installed')
    const update = vi.fn().mockRejectedValue(new Error('private update detail'))
    register.mockResolvedValue(createRegistration({ waiting, update }))
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    listenForUpdateReady(listener)

    render(<SwRegister />)

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('Service worker update check failed')
      expect(listener).toHaveBeenCalledOnce()
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private update detail')
  })

  it('observes an already-waiting worker while the fresh update check is still pending', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const waiting = createServiceWorker('installed')
    const update = vi.fn(
      () => new Promise<void>(() => undefined),
    )
    register.mockResolvedValue(createRegistration({ waiting, update }))
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    listenForUpdateReady(listener)

    render(<SwRegister />)

    await waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(update).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail.waiting).toBe(waiting)
  })

  it('renders nothing visible to the DOM', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { container } = render(<SwRegister />)
    expect(container.innerHTML).toBe('')
  })

  it('announces one typed update-ready event for an already-waiting worker', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const waiting = createServiceWorker('installed')
    register.mockResolvedValue(createRegistration({ waiting }))
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    listenForUpdateReady(listener)

    render(<SwRegister />)

    await waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(listener.mock.calls[0][0]).toBeInstanceOf(CustomEvent)
    expect(listener.mock.calls[0][0].detail).toEqual({ waiting })
  })

  it('keeps observing updates after announcing an already-waiting worker', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const firstWaiting = createServiceWorker('installed')
    const replacement = createServiceWorker()
    const registration = createRegistration({ waiting: firstWaiting })
    setController(createServiceWorker('activated'))
    register.mockResolvedValue(registration)
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    listenForUpdateReady(listener)

    render(<SwRegister />)

    await waitFor(() => expect(listener).toHaveBeenCalledOnce())

    firstWaiting.state = 'redundant'
    Object.defineProperties(registration, {
      waiting: { configurable: true, value: null },
      installing: { configurable: true, value: replacement },
    })
    registration.dispatchEvent(new Event('updatefound'))
    replacement.state = 'installed'
    replacement.dispatchEvent(new Event('statechange'))

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls.map(([event]) => event.detail.waiting)).toEqual([
      firstWaiting,
      replacement,
    ])
  })

  it('announces a newly installed worker when an existing controller proves it is an update', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const installing = createServiceWorker()
    const registration = createRegistration({ installing })
    const controller = createServiceWorker('activated')
    setController(controller)
    register.mockResolvedValue(registration)
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    listenForUpdateReady(listener)
    render(<SwRegister />)
    await waitFor(() => expect(register).toHaveBeenCalledOnce())

    registration.dispatchEvent(new Event('updatefound'))
    installing.state = 'installed'
    installing.dispatchEvent(new Event('statechange'))

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail.waiting).toBe(installing)
  })

  it('does not announce a newly installed worker during the first install', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const installing = createServiceWorker()
    const registration = createRegistration({ installing })
    register.mockResolvedValue(registration)
    const listener = vi.fn<(event: CustomEvent<PwaUpdateReadyDetail>) => void>()
    listenForUpdateReady(listener)
    render(<SwRegister />)
    await waitFor(() => expect(register).toHaveBeenCalledOnce())

    registration.dispatchEvent(new Event('updatefound'))
    installing.state = 'installed'
    installing.dispatchEvent(new Event('statechange'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps registration failures non-fatal without exposing exception details', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    register.mockRejectedValue(new Error('private registration detail'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { container } = render(<SwRegister />)

    await waitFor(() => expect(warn).toHaveBeenCalledWith('Service worker registration failed'))
    expect(container.innerHTML).toBe('')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private registration detail')
  })

  it('removes update lifecycle listeners when unmounted', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const installing = createServiceWorker()
    const registration = createRegistration({ installing })
    const removeRegistrationListener = vi.spyOn(registration, 'removeEventListener')
    const removeInstallingListener = vi.spyOn(installing, 'removeEventListener')
    register.mockResolvedValue(registration)
    const { unmount } = render(<SwRegister />)
    await waitFor(() => expect(register).toHaveBeenCalledOnce())
    registration.dispatchEvent(new Event('updatefound'))

    unmount()

    expect(removeRegistrationListener).toHaveBeenCalledWith('updatefound', expect.any(Function))
    expect(removeInstallingListener).toHaveBeenCalledWith('statechange', expect.any(Function))
  })

  it('releases redundant installers from their listener and tracking collections', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const installing = createServiceWorker()
    const registration = createRegistration({ installing })
    const addInstallingListener = vi.spyOn(installing, 'addEventListener')
    const removeInstallingListener = vi.spyOn(installing, 'removeEventListener')
    register.mockResolvedValue(registration)
    const { unmount } = render(<SwRegister />)
    await waitFor(() => {
      expect(addInstallingListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    })

    installing.state = 'redundant'
    installing.dispatchEvent(new Event('statechange'))

    expect(removeInstallingListener).toHaveBeenCalledOnce()
    registration.dispatchEvent(new Event('updatefound'))
    expect(addInstallingListener).toHaveBeenCalledTimes(2)

    unmount()
    expect(removeInstallingListener).toHaveBeenCalledTimes(2)
  })
})

describe('public/sw.js', () => {
  const swPath = resolve(__dirname, '../../public/sw.js')
  it('exists in public/', () => {
    expect(existsSync(swPath)).toBe(true)
  })

  it('keeps navigation responses out of Cache Storage and limits writes to the public-cache branch', () => {
    const source = readFileSync(swPath, 'utf-8')

    expect(source).not.toMatch(/caches\.match\(event\.request/)
    expect(source).not.toMatch(/const SHELL = \['\/'\]/)
    expect(source.match(/self\.skipWaiting\(\)/g)).toHaveLength(1)
    expect(source).toContain("data.type === 'ACTIVATE'")
    expect(source).toContain(
      "caches.match('/offline.html', { cacheName: CACHE })",
    )

    const navigateStart = source.indexOf("if (policy === 'navigate-network')")
    const publicCacheStart = source.indexOf("if (policy === 'public-cache')")

    expect(navigateStart).toBeGreaterThan(-1)
    expect(publicCacheStart).toBeGreaterThan(navigateStart)
    expect(source.slice(navigateStart, publicCacheStart)).not.toMatch(/cache\.put|cache\.match/)
    expect(source.match(/cache\.put\(/g)).toHaveLength(1)
    expect(source.indexOf('cache.put(')).toBeGreaterThan(publicCacheStart)
  })

  it('replaces active v3 even when a waiting v4 already seeded its public shell', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      proof: 'silent',
      cacheNames: ['vyntechs-shell-v3', 'vyntechs-public-shell-v4'],
    })

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).not.toHaveBeenCalled()
    expect(harness.cacheNames()).not.toContain('vyntechs-public-policy-v1')
  })

  it('trusts only the activation receipt without waiting on live worker scheduling', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: ['vyntechs-public-shell-v4', 'vyntechs-public-policy-v1'],
    })
    await installPolicyReceipt(harness)

    await harness.dispatchInstall()

    expect(harness.activeWorker?.postMessage).not.toHaveBeenCalled()
    expect(harness.skipWaiting).not.toHaveBeenCalled()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).toHaveBeenCalledOnce()
  })

  it('rejects a stale empty marker beside the exact deployed v3 worker', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      proof: 'silent',
      cacheNames: ['vyntechs-shell-v3', 'vyntechs-public-policy-v1'],
    })

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(harness.getCache('vyntechs-public-shell-v4')).toBeUndefined()
  })

  it('rejects a non-empty marker even when the active worker URL is current', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: ['vyntechs-public-policy-v1'],
    })
    await installPolicyReceipt(harness)
    await harness.getCache('vyntechs-public-policy-v1')?.put(
      '/must-not-exist',
      new Response('not a marker'),
    )

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(harness.getCache('vyntechs-public-shell-v4')).toBeUndefined()
  })

  it.each(['empty', 'wrong-receipt'] as const)(
    'rejects a %s marker even when identity and catalog are current',
    async (markerState) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        activeScriptURL:
          'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
        proof: 'silent',
        cacheNames: [
          'vyntechs-public-shell-v4',
          'vyntechs-public-policy-v1',
        ],
      })
      if (markerState === 'wrong-receipt') {
        await harness.getCache(POLICY_MARKER)?.put(
          POLICY_RECEIPT_REQUEST,
          new Response('', {
            headers: { 'x-vyntechs-cache-policy': 'private-cache-v3' },
          }),
        )
      }

      const installing = harness.dispatchInstall()
      await vi.runAllTimersAsync()
      await installing

      expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
      expect(harness.skipWaiting).toHaveBeenCalledOnce()
      expect(
        harness.getCache('vyntechs-public-shell-v4')?.addAll,
      ).not.toHaveBeenCalled()
    },
  )

  it('does not create an activation receipt while validating evicted storage', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.evictMarkerBeforeNextOpen()

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.operations).toContain('marker-evicted-before-open')
    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(harness.cacheNames()).not.toContain(POLICY_MARKER)
  })

  it('rejects an empty current marker beside any obsolete cache', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).not.toHaveBeenCalled()
  })

  it('repairs a missing marker from a timely public-only proof and still waits', async () => {
    const harness = createWorkerHarness({ proof: 'valid' })

    await harness.dispatchInstall()

    expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
    expect(harness.skipWaiting).not.toHaveBeenCalled()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).toHaveBeenCalledOnce()
    expect(harness.cacheNames()).not.toContain('vyntechs-public-policy-v1')
  })

  it.each(['invalid', 'throw'] as const)(
    'fails closed for a %s active-worker proof without seeding',
    async (proof) => {
      const harness = createWorkerHarness({ proof })

      await harness.dispatchInstall()

      expect(harness.skipWaiting).toHaveBeenCalledOnce()
      expect(harness.getCache('vyntechs-public-shell-v4')).toBeUndefined()
    },
  )

  it.each(['construct', 'start', 'close'] as const)(
    'fails closed when message-channel %s fails',
    async (channelFailure) => {
      const harness = createWorkerHarness({
        channelFailure,
        proof: channelFailure === 'close' ? 'valid' : 'invalid',
      })

      await harness.dispatchInstall()

      expect(harness.skipWaiting).toHaveBeenCalledOnce()
      expect(harness.getCache('vyntechs-public-shell-v4')).toBeUndefined()
      if (channelFailure === 'close') {
        expect(harness.activeWorker?.postMessage).toHaveBeenCalledOnce()
      }
    },
  )

  it('seeds normally and stays silent on first install', async () => {
    const harness = createWorkerHarness({ active: false })

    await harness.dispatchInstall()

    expect(harness.skipWaiting).not.toHaveBeenCalled()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).toHaveBeenCalledOnce()
    expect(harness.cacheNames()).not.toContain('vyntechs-public-policy-v1')
  })

  it.each(['open', 'addAll'] as const)(
    'bounds a hanging first-install public-shell %s operation',
    async (boundary) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        active: false,
        cacheNames: ['vyntechs-public-shell-v4'],
      })
      if (boundary === 'open') {
        harness.hangOpenFor('vyntechs-public-shell-v4')
      } else {
        harness.getCache('vyntechs-public-shell-v4')?.hangAddAllOnce()
      }

      const installing = harness.dispatchInstall()
      const outcome = Promise.race([
        installing.then(
          () => ({ kind: 'resolved' as const }),
          () => ({ kind: 'rejected' as const }),
        ),
        new Promise<{ kind: 'stalled' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'stalled' }), 2_000)
        }),
      ])
      await vi.runAllTimersAsync()

      await expect(outcome).resolves.toEqual({ kind: 'rejected' })
      expect(harness.skipWaiting).not.toHaveBeenCalled()
    },
  )

  it('answers the stable public-only proof challenge', async () => {
    const harness = createWorkerHarness({ active: false })
    const channel = new HarnessMessageChannel()
    const response = new Promise<unknown>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data)
    })

    harness.dispatchMessage(
      { type: 'VYNTECHS_CACHE_POLICY_PROBE' },
      [channel.port2],
    )

    await expect(response).resolves.toEqual({
      type: 'VYNTECHS_CACHE_POLICY_PROOF',
      capability: 'public-only-v1',
    })
  })

  it('withholds live public-only proof after an active-worker restart until recovery', () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-policy-v1',
      ],
    })
    const channel = new HarnessMessageChannel()
    const postMessage = vi.spyOn(channel.port2, 'postMessage')
    harness.rebootWorker()

    harness.dispatchMessage(
      { type: 'VYNTECHS_CACHE_POLICY_PROBE' },
      [channel.port2],
    )

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('scrubs around takeover and creates only the public activation receipt', async () => {
    const harness = createWorkerHarness({
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    const legacyCache = harness.getCache('vyntechs-shell-v3')
    await harness.getCache('vyntechs-public-policy-v1')?.put(
      '/must-be-erased',
      new Response('not a marker'),
    )

    await harness.dispatchActivate()
    await legacyCache?.put(
      'https://app.vyntechs.test/private-job',
      new Response('private job'),
    )

    expect(harness.cacheNames().sort()).toEqual([
      'vyntechs-public-policy-v1',
      'vyntechs-public-shell-v4',
    ])
    expect(
      harness.getCache('vyntechs-public-policy-v1')?.entryCount(),
    ).toBe(1)
    const receipt = await harness
      .getCache('vyntechs-public-policy-v1')
      ?.match(POLICY_RECEIPT_REQUEST)
    expect(receipt?.headers.get('x-vyntechs-cache-policy')).toBe(
      'public-only-v1',
    )
    expect(
      harness.operations.filter((operation) => operation === 'keys').length,
    ).toBeGreaterThanOrEqual(2)
    expect(harness.operations.indexOf('delete:vyntechs-shell-v3')).toBeLessThan(
      harness.operations.indexOf('claim'),
    )
    expect(harness.operations.lastIndexOf('keys')).toBeGreaterThan(
      harness.operations.indexOf('claim'),
    )
  })

  it('returns the successful public network response when cache open fails', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.failOpenFor('vyntechs-public-shell-v4')

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(harness.operations).toContain('open:vyntechs-public-shell-v4')
  })

  it('returns the successful public network response when cache match fails', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.getCache('vyntechs-public-shell-v4')?.failMatchOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.match,
    ).toHaveBeenCalledOnce()
  })

  it('returns the successful public network response when cache put fails', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.getCache('vyntechs-public-shell-v4')?.failPutOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(harness.fetchWorker).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(
        harness.getCache('vyntechs-public-shell-v4')?.put,
      ).toHaveBeenCalledOnce()
    })
  })

  it.each(['open', 'match'] as const)(
    'bounds a hanging public-cache %s and returns the successful network response',
    async (boundary) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        activeScriptURL:
          'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
        cacheNames: [
          'vyntechs-public-shell-v4',
          'vyntechs-public-policy-v1',
        ],
      })
      await installPolicyReceipt(harness)
      if (boundary === 'open') {
        harness.hangOpenFor('vyntechs-public-shell-v4')
      } else {
        harness.getCache('vyntechs-public-shell-v4')?.hangMatchOnce()
      }

      const responsePromise = harness.dispatchFetch({
        url: 'https://app.vyntechs.test/icons/icon-192.png',
        method: 'GET',
        destination: 'image',
      })
      const outcome = Promise.race([
        responsePromise.then((response) => ({ kind: 'response' as const, response })),
        new Promise<{ kind: 'stalled' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'stalled' }), 2_000)
        }),
      ])
      await vi.runAllTimersAsync()
      const result = await outcome

      expect(result.kind).toBe('response')
      if (result.kind !== 'response') return
      expect(await result.response?.text()).toBe('network-public')
      expect(harness.operations).toContain(
        boundary === 'open'
          ? 'open:vyntechs-public-shell-v4'
          : 'match:vyntechs-public-shell-v4',
      )
    },
  )

  it('does not await a hanging cache put after the public network succeeds', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.getCache('vyntechs-public-shell-v4')?.hangPutOnce()

    const responsePromise = harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })
    const outcome = Promise.race([
      responsePromise.then((response) => ({ kind: 'response' as const, response })),
      new Promise<{ kind: 'stalled' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'stalled' }), 2_000)
      }),
    ])
    await vi.runAllTimersAsync()
    const result = await outcome

    expect(result.kind).toBe('response')
    if (result.kind !== 'response') return
    expect(await result.response?.text()).toBe('network-public')
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.put,
    ).toHaveBeenCalledOnce()
  })

  it('repairs a transient activation-receipt verification failure on the next public request', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: ['vyntechs-public-shell-v4'],
    })
    harness.failCacheKeysFor(POLICY_MARKER)

    await harness.dispatchActivate()
    const fetchEvent = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await (await fetchEvent.response)?.text()).toBe('network-public')
    await fetchEvent.lifetime
    const receipt = await harness
      .getCache(POLICY_MARKER)
      ?.match(POLICY_RECEIPT_REQUEST)
    expect(receipt?.headers.get('x-vyntechs-cache-policy')).toBe(
      'public-only-v1',
    )
  })

  it('bounds a hanging durable-proof catalog and takes over without seeding', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.hangKeysOn(1)

    const installing = harness.dispatchInstall()
    await vi.runAllTimersAsync()
    await installing

    expect(harness.operations).toContain('keys')
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.addAll,
    ).not.toHaveBeenCalled()
  })

  it.each(['catalog', 'delete'] as const)(
    'bounds a hanging activation %s and still claims clients network-only',
    async (boundary) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        cacheNames: ['vyntechs-shell-v3', 'vyntechs-public-shell-v4'],
      })
      if (boundary === 'catalog') {
        harness.hangKeysOn(1, 2)
      } else {
        harness.hangDeleteFor('vyntechs-shell-v3')
      }

      const activation = harness.dispatchActivate()
      const outcome = Promise.race([
        activation.then(() => 'complete' as const),
        new Promise<'stalled'>((resolve) => {
          setTimeout(() => resolve('stalled'), 2_000)
        }),
      ])
      await vi.runAllTimersAsync()
      expect(await outcome).toBe('complete')

      expect(harness.claim).toHaveBeenCalledOnce()
      expect(harness.cacheNames()).not.toContain(POLICY_MARKER)
    },
  )

  it.each(['throw', 'hang'] as const)(
    'settles a %s client claim without restoring the legacy cache or receipt',
    async (failure) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        cacheNames: ['vyntechs-shell-v3', 'vyntechs-public-shell-v4'],
      })
      if (failure === 'throw') harness.failClaimOnce()
      else harness.hangClaimOnce()

      const activation = harness.dispatchActivate()
      const outcome = Promise.race([
        activation.then(() => 'complete' as const),
        new Promise<'stalled'>((resolve) => {
          setTimeout(() => resolve('stalled'), 2_000)
        }),
      ])
      await vi.runAllTimersAsync()

      expect(await outcome).toBe('complete')
      expect(harness.claim).toHaveBeenCalledOnce()
      expect(harness.cacheNames()).not.toContain('vyntechs-shell-v3')
      expect(harness.cacheNames()).not.toContain(POLICY_MARKER)
    },
  )

  it.each(['throw', 'hang'] as const)(
    'settles a %s activation-receipt key check and repairs on the next request',
    async (failure) => {
      vi.useFakeTimers()
      const harness = createWorkerHarness({
        activeScriptURL:
          'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
        cacheNames: ['vyntechs-public-shell-v4'],
      })
      if (failure === 'throw') harness.failCacheKeysFor(POLICY_MARKER)
      else harness.hangCacheKeysFor(POLICY_MARKER)

      const activation = harness.dispatchActivate()
      await vi.runAllTimersAsync()
      await activation
      const response = await harness.dispatchFetch({
        url: 'https://app.vyntechs.test/icons/icon-192.png',
        method: 'GET',
        destination: 'image',
      })

      expect(await response?.text()).toBe('network-public')
      const receipt = await harness
        .getCache(POLICY_MARKER)
        ?.match(POLICY_RECEIPT_REQUEST)
      expect(receipt?.headers.get('x-vyntechs-cache-policy')).toBe(
        'public-only-v1',
      )
    },
  )

  it('does not read the offline cache when durable proof is missing', async () => {
    const harness = createWorkerHarness({
      active: false,
      cacheNames: ['vyntechs-public-shell-v4'],
    })
    harness.failNetworkOnce()

    await expect(
      harness.dispatchFetch({
        url: 'https://app.vyntechs.test/today',
        method: 'GET',
        mode: 'navigate',
        destination: 'document',
      }),
    ).rejects.toThrow('network unavailable')
    expect(harness.cacheStorage.match).not.toHaveBeenCalled()
  })

  it('uses only the fixed public offline response behind full durable proof', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    await harness.getCache('vyntechs-public-shell-v4')?.put(
      '/offline.html',
      new Response('public-offline'),
    )
    harness.failNetworkOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/today',
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
    })

    expect(await response?.text()).toBe('public-offline')
    expect(harness.cacheStorage.match).toHaveBeenCalledWith('/offline.html', {
      cacheName: 'vyntechs-public-shell-v4',
    })
  })

  it('keeps failed receipt deletion revoked across a worker-global restart', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    await harness.getCache('vyntechs-public-shell-v4')?.put(
      'https://app.vyntechs.test/icons/icon-192.png',
      new Response('cached-public'),
    )
    harness.failDeleteFor(POLICY_MARKER)

    await harness.dispatchActivate()
    const firstResponse = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await firstResponse?.text()).toBe('network-public')
    harness.rebootWorker()
    const restartedResponse = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await restartedResponse?.text()).toBe('network-public')
    expect(harness.operations).toContain(`delete:${POLICY_MARKER}`)
    const receipt = await harness
      .getCache(POLICY_MARKER)
      ?.match(POLICY_RECEIPT_REQUEST)
    expect(receipt?.headers.get('x-vyntechs-cache-policy')).not.toBe(
      'public-only-v1',
    )
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.match,
    ).not.toHaveBeenCalled()
  })

  it('never trusts a stale receipt after revocation write and deletion both fail', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    await harness.getCache('vyntechs-public-shell-v4')?.put(
      'https://app.vyntechs.test/icons/icon-192.png',
      new Response('cached-public'),
    )
    harness.failPutFor(POLICY_MARKER)
    harness.failDeleteFor(POLICY_MARKER)

    await harness.dispatchActivate()
    harness.rebootWorker()
    const firstRestart = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })
    expect(await (await firstRestart.response)?.text()).toBe('network-public')
    await firstRestart.lifetime

    harness.rebootWorker()
    const secondRestart = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })
    expect(await (await secondRestart.response)?.text()).toBe('network-public')
    await secondRestart.lifetime
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.match,
    ).not.toHaveBeenCalled()
  })

  it('resumes an interrupted activation scrub during the next request lifetime', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)

    harness.rebootWorker()
    const fetchEvent = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/today',
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
    })

    expect(await (await fetchEvent.response)?.text()).toBe('network-public')
    await fetchEvent.lifetime
    expect(harness.cacheNames()).not.toContain('vyntechs-shell-v3')
    expect(harness.cacheNames()).toEqual([
      'vyntechs-public-shell-v4',
      'vyntechs-public-policy-v1',
    ])
  })

  it('returns a successful navigation without waiting for bounded recovery', async () => {
    vi.useFakeTimers()
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.hangPutFor(POLICY_MARKER)
    harness.rebootWorker()

    const fetchEvent = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/today',
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
    })
    const response = await fetchEvent.response

    expect(await response?.text()).toBe('network-public')
    expect(harness.cacheNames()).toContain('vyntechs-shell-v3')
    await vi.runAllTimersAsync()
    await fetchEvent.lifetime
    expect(harness.cacheNames()).not.toContain('vyntechs-shell-v3')
  })

  it('retries a transient active-worker recovery failure on the next request', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    await installPolicyReceipt(harness)
    harness.getCache(POLICY_MARKER)?.failPutOnce()
    harness.rebootWorker()

    const firstFetch = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/today',
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
    })
    expect(await (await firstFetch.response)?.text()).toBe('network-public')
    await firstFetch.lifetime
    expect(harness.cacheNames()).not.toContain(POLICY_MARKER)

    const secondFetch = harness.dispatchFetchWithLifetime({
      url: 'https://app.vyntechs.test/today',
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
    })
    expect(await (await secondFetch.response)?.text()).toBe('network-public')
    await secondFetch.lifetime
    const receipt = await harness
      .getCache(POLICY_MARKER)
      ?.match(POLICY_RECEIPT_REQUEST)
    expect(receipt?.headers.get('x-vyntechs-cache-policy')).toBe(
      'public-only-v1',
    )
  })

  it('rejects a stale marker after scrub and marker deletion both fail', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      cacheNames: [
        'vyntechs-shell-v3',
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    harness.failKeysOn(1, 2)
    harness.failDeleteFor('vyntechs-public-policy-v1')

    await harness.dispatchActivate()
    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(harness.cacheNames()).not.toContain('vyntechs-shell-v3')
    expect(harness.cacheNames()).toContain('vyntechs-public-policy-v1')
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.match,
    ).not.toHaveBeenCalled()
  })

  it.each([1, 2])(
    'claims the page but withholds the marker when scrub %i fails',
    async (failedScrub) => {
      const harness = createWorkerHarness({
        cacheNames: ['vyntechs-shell-v3', 'vyntechs-public-shell-v4'],
      })
      harness.failKeysOn(failedScrub)

      await harness.dispatchActivate()

      expect(harness.claim).toHaveBeenCalledOnce()
      expect(harness.operations.filter((operation) => operation === 'keys')).toHaveLength(2)
      expect(harness.cacheNames()).not.toContain('vyntechs-public-policy-v1')
    },
  )
})

describe('public/offline.html', () => {
  const offlinePath = resolve(__dirname, '../../public/offline.html')

  it('is a static, privacy-safe reconnect page', () => {
    const source = readFileSync(offlinePath, 'utf-8')

    expect(source).toMatch(/<meta\s+name="viewport"/i)
    expect(source).toContain('Vyntechs')
    expect(source).toContain('Connection needed')
    expect(source).toContain('Reconnect to continue')
    expect(source).toMatch(/<a\s+href="\/today"/i)
    expect(source).toMatch(/font-family:\s*system-ui/i)
    expect(source).not.toMatch(/<script\b/i)
  })
})
