import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { SwRegister } from '@/components/sw-register'

beforeEach(() => {
  // jsdom has no serviceWorker by default; stub it.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
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
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js')
  })

  it('renders nothing visible to the DOM', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { container } = render(<SwRegister />)
    expect(container.innerHTML).toBe('')
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
