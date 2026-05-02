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

  it('skips /api/ and /_next/ from the cache fetch handler', () => {
    const src = readFileSync(swPath, 'utf-8')
    expect(src).toMatch(/\/api\//)
    expect(src).toMatch(/\/_next\//)
    expect(src).toMatch(/install/)
    expect(src).toMatch(/fetch/)
  })
})
