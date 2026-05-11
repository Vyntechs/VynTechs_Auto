import { describe, it, expect, afterEach, vi } from 'vitest'
import { isFounder } from '@/lib/auth'

const FOUNDER_ID = '00000000-0000-0000-0000-000000000abc'

describe('isFounder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns true when userId equals FOUNDER_USER_ID', () => {
    vi.stubEnv('FOUNDER_USER_ID', FOUNDER_ID)
    expect(isFounder(FOUNDER_ID)).toBe(true)
  })

  it('returns false for any other userId', () => {
    vi.stubEnv('FOUNDER_USER_ID', FOUNDER_ID)
    expect(isFounder('00000000-0000-0000-0000-000000000def')).toBe(false)
  })

  it('returns false when FOUNDER_USER_ID is unset (gate stays closed)', () => {
    vi.stubEnv('FOUNDER_USER_ID', '')
    expect(isFounder(FOUNDER_ID)).toBe(false)
  })

  it('returns false for null/undefined userId even when env is set', () => {
    vi.stubEnv('FOUNDER_USER_ID', FOUNDER_ID)
    expect(isFounder(null)).toBe(false)
    expect(isFounder(undefined)).toBe(false)
  })
})
