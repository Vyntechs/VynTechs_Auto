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
  const listeners = new Map<string, Array<(event: any) => void>>()
  const operations: string[] = []
  const cachesByName = new Map<string, ReturnType<typeof makeCache>>()
  const failDeleteNames = new Set<string>()
  let failNextOpen = false
  let failNextFetch = false
  let failKeysCalls = new Set<number>()
  let keysCallCount = 0

  function makeCache(name: string) {
    const entries = new Map<string, Response>()
    let failNextMatch = false
    let failNextPut = false
    const cache = {
      addAll: vi.fn(async (requests: string[]) => {
        operations.push(`seed:${name}`)
        for (const request of requests) {
          entries.set(request, new Response(`public:${request}`, { status: 200 }))
        }
      }),
      match: vi.fn(async (request: unknown) => {
        operations.push(`match:${name}`)
        if (failNextMatch) {
          failNextMatch = false
          throw new Error('cache match unavailable')
        }
        return entries.get(cacheRequestKey(request))
      }),
      put: vi.fn(async (request: unknown, response: Response) => {
        operations.push(`put:${name}`)
        if (failNextPut) {
          failNextPut = false
          throw new Error('cache put unavailable')
        }
        entries.set(cacheRequestKey(request), response)
      }),
      keys: vi.fn(async () => [...entries.keys()]),
      failMatchOnce() {
        failNextMatch = true
      },
      failPutOnce() {
        failNextPut = true
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
      if (failKeysCalls.has(keysCallCount)) {
        throw new Error('cache catalog unavailable')
      }
      return [...cachesByName.keys()]
    }),
    delete: vi.fn(async (name: string) => {
      operations.push(`delete:${name}`)
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
  const claim = vi.fn(async () => {
    operations.push('claim')
  })
  const fetchResponse = new Response('network-public', { status: 200 })
  const fetchWorker = vi.fn(async () => {
    if (failNextFetch) {
      failNextFetch = false
      throw new Error('network unavailable')
    }
    return fetchResponse.clone()
  })
  const workerSelf = {
    registration: { active: activeWorker },
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

  async function dispatchFetch(request: {
    url: string
    method: string
    mode?: string
    destination?: string
  }) {
    let response: Promise<Response | undefined> | undefined
    for (const listener of listeners.get('fetch') ?? []) {
      listener({
        request,
        respondWith(value: Promise<Response | undefined>) {
          response = Promise.resolve(value)
        },
      })
    }
    if (!response) throw new Error('fetch was not intercepted')
    return response
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
    dispatchInstall: () => dispatchExtendable('install'),
    dispatchMessage,
    failOpenOnce() {
      failNextOpen = true
    },
    failDeleteFor(name: string) {
      failDeleteNames.add(name)
    },
    failKeysOn(...calls: number[]) {
      failKeysCalls = new Set(calls)
    },
    failNetworkOnce() {
      failNextFetch = true
    },
    fetchWorker,
    getCache(name: string) {
      return cachesByName.get(name)
    },
    operations,
    skipWaiting,
    cacheNames: () => [...cachesByName.keys()],
  }
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

  it('trusts only the activation marker without waiting on live worker scheduling', async () => {
    const harness = createWorkerHarness({
      activeScriptURL:
        'https://app.vyntechs.test/sw.js?cache-policy=public-v4',
      proof: 'silent',
      cacheNames: ['vyntechs-public-shell-v4', 'vyntechs-public-policy-v1'],
    })

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
      const harness = createWorkerHarness({ channelFailure, proof: 'invalid' })

      await harness.dispatchInstall()

      expect(harness.skipWaiting).toHaveBeenCalledOnce()
      expect(harness.getCache('vyntechs-public-shell-v4')).toBeUndefined()
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

  it('scrubs around takeover and creates only an empty activation marker', async () => {
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
    ).toBe(0)
    expect(harness.operations.filter((operation) => operation === 'keys')).toHaveLength(2)
    expect(harness.operations.indexOf('delete:vyntechs-shell-v3')).toBeLessThan(
      harness.operations.indexOf('claim'),
    )
    expect(harness.operations.lastIndexOf('keys')).toBeGreaterThan(
      harness.operations.indexOf('claim'),
    )
  })

  it('returns the successful public network response when cache open fails', async () => {
    const harness = createWorkerHarness({
      active: false,
      cacheNames: ['vyntechs-public-policy-v1'],
    })
    harness.failOpenOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
  })

  it('returns the successful public network response when cache match fails', async () => {
    const harness = createWorkerHarness({
      active: false,
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    harness.getCache('vyntechs-public-shell-v4')?.failMatchOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
  })

  it('returns the successful public network response when cache put fails', async () => {
    const harness = createWorkerHarness({
      active: false,
      cacheNames: [
        'vyntechs-public-shell-v4',
        'vyntechs-public-policy-v1',
      ],
    })
    harness.getCache('vyntechs-public-shell-v4')?.failPutOnce()

    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(harness.fetchWorker).toHaveBeenCalledOnce()
  })

  it('stays network-only when activation cannot recreate the marker', async () => {
    const harness = createWorkerHarness({
      active: false,
      cacheNames: ['vyntechs-public-shell-v4'],
    })
    harness.failOpenOnce()

    await harness.dispatchActivate()
    const response = await harness.dispatchFetch({
      url: 'https://app.vyntechs.test/icons/icon-192.png',
      method: 'GET',
      destination: 'image',
    })

    expect(await response?.text()).toBe('network-public')
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.match,
    ).not.toHaveBeenCalled()
    expect(
      harness.getCache('vyntechs-public-shell-v4')?.put,
    ).not.toHaveBeenCalled()
    expect(harness.cacheNames()).not.toContain('vyntechs-public-policy-v1')
  })

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
    expect(harness.cacheNames()).toContain('vyntechs-shell-v3')
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
