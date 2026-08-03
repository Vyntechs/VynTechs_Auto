import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPaywallExempt } from '@/lib/auth-access'

describe('customer approval public boundary', () => {
  it('exempts only the intended page and API while neighboring paths stay authenticated', () => {
    expect(isPaywallExempt('/approve')).toBe(true)
    expect(isPaywallExempt('/api/public/quote-approval')).toBe(true)
    expect(isPaywallExempt('/approvals')).toBe(false)
    expect(isPaywallExempt('/approve/history')).toBe(false)
    expect(isPaywallExempt('/api/public/quote-approval/export')).toBe(false)
    expect(isPaywallExempt('/api/public')).toBe(false)
  })

  it('serves the exact public page without browser or intermediary caching', () => {
    const config = readFileSync(resolve(process.cwd(), 'next.config.js'), 'utf8')
    expect(config).toMatch(/source: '\/approve'[\s\S]*?Cache-Control'[\s\S]*?no-store, max-age=0/)
    expect(config).toMatch(/source: '\/approve'[\s\S]*?Referrer-Policy'[\s\S]*?no-referrer/)
    expect(config).toMatch(/source: '\/approve'[\s\S]*?X-Robots-Tag'[\s\S]*?noindex, nofollow/)
  })
})
