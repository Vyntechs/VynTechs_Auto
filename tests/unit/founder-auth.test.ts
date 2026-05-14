import { describe, it, expect, afterEach, vi } from 'vitest'
import { isFounder } from '@/lib/auth'

const FOUNDER_EMAIL = 'brandon@vyntechs.com'
const MAC_EMAIL = 'maclainyoung@vyntechs.com'

describe('isFounder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('FOUNDER_EMAILS (plural, current contract)', () => {
    it('returns true for any email in the comma-separated list', () => {
      vi.stubEnv('FOUNDER_EMAILS', `${FOUNDER_EMAIL},${MAC_EMAIL}`)
      expect(isFounder(FOUNDER_EMAIL)).toBe(true)
      expect(isFounder(MAC_EMAIL)).toBe(true)
    })

    it('matches case-insensitively across entries', () => {
      vi.stubEnv('FOUNDER_EMAILS', `Brandon@VynTechs.com,MACLAINYOUNG@vyntechs.com`)
      expect(isFounder('brandon@vyntechs.com')).toBe(true)
      expect(isFounder('maclainyoung@VYNTECHS.com')).toBe(true)
    })

    it('trims whitespace around each entry', () => {
      vi.stubEnv('FOUNDER_EMAILS', `  ${FOUNDER_EMAIL}  ,  ${MAC_EMAIL}  `)
      expect(isFounder(FOUNDER_EMAIL)).toBe(true)
      expect(isFounder(MAC_EMAIL)).toBe(true)
    })

    it('ignores empty entries (trailing commas, double commas)', () => {
      vi.stubEnv('FOUNDER_EMAILS', `,${FOUNDER_EMAIL},,${MAC_EMAIL},`)
      expect(isFounder(FOUNDER_EMAIL)).toBe(true)
      expect(isFounder(MAC_EMAIL)).toBe(true)
      // Empty-string lookups must never match an empty entry
      expect(isFounder('')).toBe(false)
    })

    it('returns false for emails not in the list', () => {
      vi.stubEnv('FOUNDER_EMAILS', `${FOUNDER_EMAIL},${MAC_EMAIL}`)
      expect(isFounder('someone-else@vyntechs.com')).toBe(false)
    })

    it('works with a single email (no comma)', () => {
      vi.stubEnv('FOUNDER_EMAILS', FOUNDER_EMAIL)
      expect(isFounder(FOUNDER_EMAIL)).toBe(true)
      expect(isFounder(MAC_EMAIL)).toBe(false)
    })
  })

  describe('FOUNDER_EMAIL (legacy singular, fallback)', () => {
    it('falls back to FOUNDER_EMAIL when FOUNDER_EMAILS is unset', () => {
      vi.stubEnv('FOUNDER_EMAILS', '')
      vi.stubEnv('FOUNDER_EMAIL', FOUNDER_EMAIL)
      expect(isFounder(FOUNDER_EMAIL)).toBe(true)
    })

    it('FOUNDER_EMAILS takes precedence over FOUNDER_EMAIL when both are set', () => {
      vi.stubEnv('FOUNDER_EMAILS', MAC_EMAIL)
      vi.stubEnv('FOUNDER_EMAIL', FOUNDER_EMAIL)
      expect(isFounder(MAC_EMAIL)).toBe(true)
      expect(isFounder(FOUNDER_EMAIL)).toBe(false)
    })

    it('matches case-insensitively via the singular path', () => {
      vi.stubEnv('FOUNDER_EMAILS', '')
      vi.stubEnv('FOUNDER_EMAIL', 'Brandon@VynTechs.com')
      expect(isFounder('brandon@vyntechs.com')).toBe(true)
      vi.stubEnv('FOUNDER_EMAIL', 'brandon@vyntechs.com')
      expect(isFounder('BRANDON@VYNTECHS.COM')).toBe(true)
    })

    it('trims whitespace via the singular path', () => {
      vi.stubEnv('FOUNDER_EMAILS', '')
      vi.stubEnv('FOUNDER_EMAIL', '  brandon@vyntechs.com  ')
      expect(isFounder('brandon@vyntechs.com')).toBe(true)
    })
  })

  describe('fail-closed behavior', () => {
    it('returns false when both env vars are unset (gate stays closed)', () => {
      vi.stubEnv('FOUNDER_EMAILS', '')
      vi.stubEnv('FOUNDER_EMAIL', '')
      expect(isFounder(FOUNDER_EMAIL)).toBe(false)
    })

    it('returns false for null/undefined/empty email even when env is set', () => {
      vi.stubEnv('FOUNDER_EMAILS', FOUNDER_EMAIL)
      expect(isFounder(null)).toBe(false)
      expect(isFounder(undefined)).toBe(false)
      expect(isFounder('')).toBe(false)
    })

    it('whitespace-only email never matches', () => {
      vi.stubEnv('FOUNDER_EMAILS', FOUNDER_EMAIL)
      expect(isFounder('   ')).toBe(false)
    })
  })
})
