import { describe, expect, it } from 'vitest'
import { isExpectedPageNavigationAbort } from '@/tests/e2e/golden-browser-fault-filter'

describe('Golden browser fault receipts', () => {
  it('ignores only canceled GET page navigations, never API or mutation failures', () => {
    expect(isExpectedPageNavigationAbort('GET', '/tickets/new', 'net::ERR_ABORTED')).toBe(true)
    expect(isExpectedPageNavigationAbort('GET', '/api/tickets', 'net::ERR_ABORTED')).toBe(false)
    expect(isExpectedPageNavigationAbort('POST', '/tickets/new', 'net::ERR_ABORTED')).toBe(false)
    expect(isExpectedPageNavigationAbort('GET', '/tickets/new', 'net::ERR_FAILED')).toBe(false)
  })
})
