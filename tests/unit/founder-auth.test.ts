import { describe, it, expect, afterEach, vi } from 'vitest'
import { isFounder } from '@/lib/auth'

const FOUNDER_EMAIL = 'brandon@vyntechs.com'

describe('isFounder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns true when email matches FOUNDER_EMAIL', () => {
    vi.stubEnv('FOUNDER_EMAIL', FOUNDER_EMAIL)
    expect(isFounder(FOUNDER_EMAIL)).toBe(true)
  })

  it('matches case-insensitively (Supabase normalizes but env var may not)', () => {
    vi.stubEnv('FOUNDER_EMAIL', 'Brandon@VynTechs.com')
    expect(isFounder('brandon@vyntechs.com')).toBe(true)
    vi.stubEnv('FOUNDER_EMAIL', 'brandon@vyntechs.com')
    expect(isFounder('BRANDON@VYNTECHS.COM')).toBe(true)
  })

  it('trims surrounding whitespace on both sides', () => {
    vi.stubEnv('FOUNDER_EMAIL', '  brandon@vyntechs.com  ')
    expect(isFounder('brandon@vyntechs.com')).toBe(true)
  })

  it('returns false for any other email', () => {
    vi.stubEnv('FOUNDER_EMAIL', FOUNDER_EMAIL)
    expect(isFounder('someone-else@vyntechs.com')).toBe(false)
  })

  it('returns false when FOUNDER_EMAIL is unset (gate stays closed)', () => {
    vi.stubEnv('FOUNDER_EMAIL', '')
    expect(isFounder(FOUNDER_EMAIL)).toBe(false)
  })

  it('returns false for null/undefined email even when env is set', () => {
    vi.stubEnv('FOUNDER_EMAIL', FOUNDER_EMAIL)
    expect(isFounder(null)).toBe(false)
    expect(isFounder(undefined)).toBe(false)
  })
})
