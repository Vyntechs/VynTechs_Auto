import { describe, expect, it } from 'vitest'
import {
  isExpectedLocalAnalyticsConsole,
  isExpectedPageNavigationAbort,
} from '@/tests/e2e/golden-browser-fault-filter'

describe('Golden browser fault receipts', () => {
  it('ignores only canceled GET page navigations, never API or mutation failures', () => {
    expect(isExpectedPageNavigationAbort('GET', '/tickets/new', 'net::ERR_ABORTED')).toBe(true)
    expect(isExpectedPageNavigationAbort('GET', '/api/tickets', 'net::ERR_ABORTED')).toBe(false)
    expect(isExpectedPageNavigationAbort('POST', '/tickets/new', 'net::ERR_ABORTED')).toBe(false)
    expect(isExpectedPageNavigationAbort('GET', '/tickets/new', 'net::ERR_FAILED')).toBe(false)
  })

  it('ignores only the missing Vercel Analytics script on local hosts', () => {
    const missing = 'Failed to load resource: the server responded with a status of 404 (Not Found)'
    const refused = [
      "Refused to execute script from 'http://127.0.0.1:3210/_vercel/insights/script.js'",
      "because its MIME type ('text/html') is not executable, and strict MIME type checking is enabled.",
    ].join(' ')

    expect(isExpectedLocalAnalyticsConsole(
      'http://127.0.0.1:3210/today',
      'http://127.0.0.1:3210/_vercel/insights/script.js',
      missing,
    )).toBe(true)
    expect(isExpectedLocalAnalyticsConsole(
      'http://localhost:3210/today',
      '',
      refused,
    )).toBe(true)
    expect(isExpectedLocalAnalyticsConsole(
      'https://vyntechs.dev/today',
      'https://vyntechs.dev/_vercel/insights/script.js',
      missing,
    )).toBe(false)
    expect(isExpectedLocalAnalyticsConsole(
      'http://127.0.0.1:3210/today',
      'http://127.0.0.1:3210/api/missing',
      missing,
    )).toBe(false)
    expect(isExpectedLocalAnalyticsConsole(
      'http://127.0.0.1:3210/today',
      'http://127.0.0.1:3210/_vercel/insights/script.js',
      'Uncaught TypeError: broken',
    )).toBe(false)
  })
})
