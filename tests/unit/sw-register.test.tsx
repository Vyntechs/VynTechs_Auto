import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
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
}: {
  waiting?: ServiceWorker | null
  installing?: ServiceWorker | null
} = {}): ServiceWorkerRegistration {
  const registration = new EventTarget() as ServiceWorkerRegistration

  Object.defineProperties(registration, {
    waiting: { configurable: true, value: waiting },
    installing: { configurable: true, value: installing },
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
})

describe('SwRegister', () => {
  it('does not register the service worker outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<SwRegister />)
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
  })

  it('registers /sw.js once in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<SwRegister />)
    expect(register).toHaveBeenCalledWith('/sw.js')
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
    expect(source).toContain("caches.match('/offline.html')")

    const navigateStart = source.indexOf("if (policy === 'navigate-network')")
    const publicCacheStart = source.indexOf("if (policy === 'public-cache')")

    expect(navigateStart).toBeGreaterThan(-1)
    expect(publicCacheStart).toBeGreaterThan(navigateStart)
    expect(source.slice(navigateStart, publicCacheStart)).not.toMatch(/cache\.put|cache\.match/)
    expect(source.match(/cache\.put\(/g)).toHaveLength(1)
    expect(source.indexOf('cache.put(')).toBeGreaterThan(publicCacheStart)
  })
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
