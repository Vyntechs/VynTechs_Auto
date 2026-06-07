import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The 8 tokens topology.css consumes but the app never defined. Values are the
// proto-meter.html canon.
const REQUIRED_TOKENS: Record<string, string> = {
  '--role-12v': 'oklch(62% .20 30)',
  '--role-ground': 'var(--vt-bone-700)',
  '--role-signal': 'var(--vt-signal-400)',
  '--role-5v-ref': 'var(--vt-signal-300)',
  '--role-low-ref': 'oklch(66% .07 230)',
  '--role-pwm': 'oklch(58% .16 300)',
  '--vt-recede': '0.16',
  '--vt-amber-600': 'oklch(58% .16 55)',
}

describe('globals.css diagram tokens', () => {
  const css = readFileSync(
    path.resolve(__dirname, '../../../app/globals.css'),
    'utf8',
  )

  for (const [token, value] of Object.entries(REQUIRED_TOKENS)) {
    it(`defines ${token} with the proto-meter value`, () => {
      const tokenEsc = token.replace(/-/g, '\\-')
      const valueEsc = value
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/ /g, '\\s+')
      const re = new RegExp(`${tokenEsc}\\s*:\\s*${valueEsc}\\s*;`)
      expect(css).toMatch(re)
    })
  }
})
