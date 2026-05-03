import { describe, it, expect, afterEach, vi } from 'vitest'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'

describe('isDesktopIntakeEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns false when env var is empty/unset', () => {
    vi.stubEnv('NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED', '')
    expect(isDesktopIntakeEnabled()).toBe(false)
  })

  it('returns true when env var is exactly "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED', 'true')
    expect(isDesktopIntakeEnabled()).toBe(true)
  })

  it('returns false for non-"true" string values', () => {
    vi.stubEnv('NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED', '1')
    expect(isDesktopIntakeEnabled()).toBe(false)
  })
})
