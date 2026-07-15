import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getDiagnosticsRelease,
  getOperationalMediaRelease,
  isDiagnosticsReleaseEnabled,
  isOperationalMediaEnabled,
  OPERATIONAL_MEDIA_UNAVAILABLE,
} from '@/lib/release-policy'

describe('release policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([undefined, '', 'off', ' true ', 'legacy ', 'on', 'unknown'])(
    'fails diagnostics closed for %s',
    (value) => {
      vi.stubEnv('NODE_ENV', 'test')
      if (value === undefined) vi.stubEnv('DIAGNOSTICS_RELEASE', undefined)
      else vi.stubEnv('DIAGNOSTICS_RELEASE', value)

      expect(getDiagnosticsRelease()).toBe('off')
      expect(isDiagnosticsReleaseEnabled()).toBe(false)
    },
  )

  it('allows only exact legacy outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DIAGNOSTICS_RELEASE', 'legacy')

    expect(getDiagnosticsRelease()).toBe('legacy')
    expect(isDiagnosticsReleaseEnabled()).toBe(true)
  })

  it('keeps production hard-off even when legacy is requested', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DIAGNOSTICS_RELEASE', 'legacy')

    expect(getDiagnosticsRelease()).toBe('off')
    expect(isDiagnosticsReleaseEnabled()).toBe(false)
  })

  it('has no operational-media enablement path', () => {
    vi.stubEnv('OPERATIONAL_MEDIA_RELEASE', 'on')

    expect(getOperationalMediaRelease()).toBe('off')
    expect(isOperationalMediaEnabled()).toBe(false)
    expect(OPERATIONAL_MEDIA_UNAVAILABLE).toEqual({
      status: 404,
      body: { error: 'not_available' },
    })
  })
})
