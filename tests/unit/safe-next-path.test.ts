import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/safe-next-path'

describe('safeNextPath', () => {
  it.each([
    ['/today', '/today'],
    ['/tickets/123?from=today#job-2', '/tickets/123?from=today#job-2'],
    ['/settings/billing', '/settings/billing'],
  ])('preserves an application-local path', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected)
  })

  it.each([
    null,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/tickets\\..\\evil.example',
    '/tickets\nnext',
    '/tickets\u0000next',
  ])('falls back for an ambiguous or external return target %#', (raw) => {
    expect(safeNextPath(raw)).toBe('/today')
  })

  it('supports an explicit local fallback', () => {
    expect(safeNextPath('/\\evil.example', '/sign-in')).toBe('/sign-in')
  })
})
